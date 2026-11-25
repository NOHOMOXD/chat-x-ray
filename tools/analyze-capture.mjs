#!/usr/bin/env node
import { chatAccess, modeProfile } from '../src/platform/chat-mode.js';
/*
 * Twitch Chat X-Ray — offline capture analyzer (developer tool).
 *
 * This is a diagnostic helper, not part of the extension. The extension itself
 * never makes network requests. The tool replays a chat capture collected from
 * Twitch's public read-only IRC endpoint through the real Analyzer and prints
 * how the scoring, id clusters and the chat-based viewer estimate behave.
 *
 * Capture formats (one JSON object per line):
 *   chat:    {"ts": 1794970575728, "line": "@badge-info=... PRIVMSG #chan :text"}
 *   viewers: {"ts": 1794970575728, "viewers": 56090}
 *
 * Usage:
 *   node tools/analyze-capture.mjs \
 *     --chat samples/chat.jsonl [--viewers samples/viewers.jsonl] [--json out.json]
 *
 * Minimal live capture commands are documented in README ("Проверка на живом
 * канале"). Keep captures public, short, and do not commit them.
 */
import fs from 'node:fs';
import { parseFrame } from '../src/platform/irc-parser.js';
import { Analyzer } from '../src/core/analyzer.js';
import { ViewerHistory } from '../src/analysis/viewer-history.js';
import { buildViewerModel, estimateViewerRange } from '../src/analysis/viewer-estimate.js';
import { formatNumber } from '../src/ui/shared/ui-utils.js';

import { compareIdGroupScores, estimateWindow, summarizeRecords } from '../src/analysis/session-capture.js';
import { describeGroups, findIdGroups, recordsAt, summarizeMatches } from '../src/core/id-group-diagnostics.js';
import { DEFAULTS as SETTINGS } from '../src/config/settings.js';

function parseArgs(argv) {
  const args = { chat: '', viewers: '', json: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--movements') {
      args.movements = true;
    } else if (key === '--snapshot') {
      args.snapshot = value;
      i += 1;
    } else if (key === '--reference') {
      args.reference = value;
      i += 1;
    } else if (key === '--chat') {
      args.chat = value || '';
      i += 1;
    } else if (key === '--viewers') {
      args.viewers = value || '';
      i += 1;
    } else if (key === '--json') {
      args.json = value || '';
      i += 1;
    }
  }
  return args;
}

function readJsonl(file) {
  if (!file || !fs.existsSync(file)) {
    return [];
  }
  const rows = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch (_error) {
      // Ignore a truncated final line.
    }
  }
  return rows;
}

function percent(part, total) {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

function formatTime(ts) {
  return new Date(ts).toISOString().slice(11, 19);
}

function compareRanges(model, stats) {
  if (!model) {
    return null;
  }
  return {
    displayed: model.range,
    withoutShortWindowScale: estimateViewerRange(Math.min(model.official, model.stableOfficial), {
      ...stats, sessionMs: 600000,
    }),
    withSixToTwelvePercent: estimateViewerRange(Math.min(model.official, model.stableOfficial), stats, {
      viewersPerChatterLow: 100 / 12,
      viewersPerChatterHigh: 100 / 6,
    }),
  };
}

function compareEvents(events, reference, samples) {
  return events.filter((event) => ['surge', 'churn', 'viewer-outflow'].includes(event.kind)).map((event) => {
    const closest = (rows, ts) => rows.reduce((best, row) =>
      !best || Math.abs(row.ts - ts) < Math.abs(best.ts - ts) ? row : best, null);
    const endTs = event.kind === 'surge' ? event.ts : event.lowTs;
    const startTs = event.fromTs ?? event.ts - event.durationMs;
    return {
      ...event,
      nearestViewerSample: closest(samples, endTs),
      referenceFrom: closest(reference, startTs),
      referenceTo: closest(reference, endTs),
    };
  });
}

function replayViewerOutflows(snapshot, now) {
  const history = new ViewerHistory();
  const outflows = [];
  const surges = [];
  const timeline = [
    ...snapshot.viewerSamples,
    ...snapshot.events.filter(({ kind }) => ['viewer-gap', 'raid'].includes(kind)),
  ].sort((a, b) => a.ts - b.ts);
  for (const entry of timeline) {
    if (entry.kind === 'viewer-gap') {
      history.interrupt(entry.ts);
    } else if (entry.kind === 'raid') {
      history.recordRaid(entry);
    } else {
      const accepted = history.record(entry.value, entry.ts, { cleanUsers: entry.clean });
      if (accepted?.anomaly?.kind === 'surge') surges.push(accepted.anomaly);
      if (accepted?.outflow) outflows.push(accepted.outflow);
    }
  }
  const stats = history.getStats(now);
  return { count: stats.totalOutflows, outflows, surges };
}

function replayWave(event, current, exportedAt) {
  if (event.atTrigger) return event;
  const context = recordsAt(current.messages, event.ts);
  const subjects = context.filter((record) => record.waveBoost && record.bucketStart === event.bucketStart);
  const members = new Set(subjects.map((record) => record.userKey));
  return {
    ...event,
    atTrigger: {
      ts: event.ts,
      completeWindow: exportedAt - current.durationMs <= event.ts - 600000,
      groups: describeGroups(findIdGroups(context), context),
      ...summarizeMatches(subjects, context, members),
    },
  };
}

function analyzeSnapshot(args) {
  const snapshot = JSON.parse(fs.readFileSync(args.snapshot, 'utf8'));
  let report;
  if (args.movements) {
    report = replayViewerOutflows(snapshot, Date.parse(snapshot.exportedAt));
  } else if (Array.isArray(snapshot)) {
    const triggers = new Map();
    for (const entry of snapshot) {
      for (const key of entry.triggerKeys || []) {
        triggers.set(key, (triggers.get(key) || 0) + 1);
      }
    }
    report = { kind: 'selected-audit', entries: snapshot.length, triggers: Object.fromEntries(triggers) };
  } else {
    if (![1, 2, 3].includes(snapshot.schemaVersion)) {
      throw new Error('Unknown session snapshot format');
    }
    const { current, minutes, events } = snapshot;
    const settings = snapshot.settings.at(-1)?.value || SETTINGS;
    const now = Date.parse(snapshot.exportedAt);
    const model = snapshot.schemaVersion >= 3 && current.model?.input ? buildViewerModel(current.model.input) : current.model;
    const reportMinutes = minutes.map((row) => ({
      ts: row.ts, coverageMs: row.stats.sessionMs, minute: row.minute,
      topAuthorMessages: row.minute?.topAuthorMessages ?? null,
      audienceMessages: row.minute?.audienceMessages ?? null,
      official: row.model?.official, diagnostics: row.diagnostics,
      idGroupAudit: row.idGroupAudit ?? null,
      ranges: compareRanges(row.model, row.stats),
    }));
    const firstFull = reportMinutes.find((row) => row.coverageMs >= 600000);
    const early = [1, 2, 5].map((minute) => {
      const observed = reportMinutes.find((row) =>
        row.coverageMs >= minute * 60000 && row.coverageMs < (minute + 1) * 60000);
      return { minute, displayed: observed?.ranges?.displayed ?? null };
    });
    report = {
      kind: 'session-snapshot',
      channel: snapshot.channel,
      current: {
        model,
        matchingDisplayedRange: JSON.stringify(model?.range) === JSON.stringify(current.model?.range),
        ranges: compareRanges(model, current.stats),
        diagnostics: snapshot.schemaVersion === 1 ? current.diagnostics ?? null : summarizeRecords(estimateWindow(current.messages, current.stats), settings, {
          official: model?.official, stableOfficial: model?.stableOfficial, stats: current.stats,
        }),
        idGroupAudit: current.idGroupAudit ??
          compareIdGroupScores(current.messages, now, settings, model, current.stats),
        swarm: findBursts(current.messages),
      },
      warmup: { early, full: firstFull?.ranges?.displayed ?? null },
      minutes: reportMinutes,
      viewerOutflows: replayViewerOutflows(snapshot, now),
      chatWaves: events.filter(({ kind }) => kind === 'chat-wave')
        .map((event) => replayWave(event, current, now)),
      events: compareEvents(events, readJsonl(args.reference), snapshot.viewerSamples),
      exportedAt: now,
    };
  }
  const json = JSON.stringify(report, null, 2) + '\n';
  if (args.json) {
    fs.writeFileSync(args.json, json);
  } else {
    process.stdout.write(json);
  }
}

function findBursts(messages) {
  const ordered = messages.filter((message) =>
    message.serverTimestamp && !message.roleExempt && message.userId)
    .sort((a, b) => a.ts - b.ts);
  const bursts = [];
  let end = 0;
  for (let start = 0; start < ordered.length; start += 1) {
    const ts = ordered[start].ts;
    while (end < ordered.length && ordered[end].ts - ts <= 100) end += 1;
    const window = ordered.slice(start, end);
    const authors = new Set(window.map((message) => message.userId));
    const texts = new Set(window.map((message) => message.text.trim().toLowerCase()));
    if (authors.size >= 8 && texts.size > 1) {
      bursts.push({ ts, authors: authors.size });
      start = end - 1;
    }
  }
  return bursts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.snapshot) {
    analyzeSnapshot(args);
    return;
  }
  if (!args.chat) {
    console.error(
      'Usage: node tools/analyze-capture.mjs (--snapshot <session.json> [--reference <viewers.jsonl>] | --chat <chat.jsonl> [--viewers <viewers.jsonl>]) [--json <out.json>]'
    );
    process.exit(1);
  }

  const chatRows = readJsonl(args.chat);
  const allViewerRows = readJsonl(args.viewers)
    .filter((row) => Number.isFinite(row.viewers) && row.viewers > 0)
    .sort((a, b) => a.ts - b.ts);
  const messages = [];
  const seenMessageIds = new Set();
  for (let i = 0; i < chatRows.length; i += 1) {
    const row = chatRows[i];
    if (!Number.isFinite(row.ts)) continue;
    for (const message of parseFrame(row.line, row.ts)) {
      if (message.id && seenMessageIds.has(message.id)) {
        continue;
      }
      if (message.id) {
        seenMessageIds.add(message.id);
      }
      messages.push({ ts: row.ts, message });
    }
  }
  messages.sort((a, b) => a.ts - b.ts);

  if (!messages.length) {
    console.error('No PRIVMSG lines found in the capture.');
    process.exit(1);
  }

  // A viewer capture may outlive the chat capture. Chat-based metrics decay
  // once messages stop arriving, so only viewer samples inside the chat span
  // (+1 min) contribute to the model.
  const chatEndTs = messages[messages.length - 1].ts;
  const viewerRows = allViewerRows.filter(
    (row) => row.ts <= chatEndTs + 60 * 1000
  );

  const analyzer = new Analyzer({ enableAuditLog: false });
  const history = new ViewerHistory();
  const triggerCounts = new Map();
  const allUsers = new Set();
  const freshUsers = new Set();
  const clusterUsers = new Set();
  const scoreBuckets = { low: 0, mid: 0, high: 0 };
  let maxBotScore = 0;
  let model = null;
  let lastViewer = null;
  const timeline = [];
  let roomMode = {};
  let roomSince = messages[0].ts;
  function viewerStats(ts) {
    return { ...analyzer.getStats(ts, messages[0].ts), mixedMode: roomSince > messages[0].ts && ts - roomSince < 600000, roomMode, chatAccess: chatAccess(roomMode) };
  }

  const events = [];
  for (let i = 0; i < messages.length; i += 1) {
    events.push({ kind: 'message', ts: messages[i].ts, message: messages[i].message });
  }
  for (let i = 0; i < viewerRows.length; i += 1) {
    events.push({ kind: 'viewer', ts: viewerRows[i].ts, viewers: viewerRows[i].viewers });
  }
  events.sort((a, b) => a.ts - b.ts);

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];

    if (event.kind === 'message') {
      if (event.message.kind === 'room-state') {
        const next = { ...roomMode, ...event.message.mode };
        if (modeProfile(next) !== modeProfile(roomMode)) roomSince = event.ts;
        roomMode = next;
        continue;
      }
      if (event.message.kind === 'raid') {
        history.recordRaid(event.message);
        continue;
      }
      const result = analyzer.ingest(event.message, event.ts);
      if (!result.record) {
        continue;
      }
      const record = result.record;
      allUsers.add(record.userKey);
      if (record.freshAccount) {
        freshUsers.add(record.userKey);
      }
      if (record.clusterPeers >= 2) {
        clusterUsers.add(record.userKey);
      }
      maxBotScore = Math.max(maxBotScore, record.botScore);
      if (record.botScore >= 50) {
        scoreBuckets.high += 1;
      } else if (record.botScore >= 30) {
        scoreBuckets.mid += 1;
      } else {
        scoreBuckets.low += 1;
      }
      for (let t = 0; t < record.triggers.length; t += 1) {
        const key = record.triggers[t].key;
        triggerCounts.set(key, (triggerCounts.get(key) || 0) + 1);
      }
      continue;
    }

    lastViewer = event.viewers;
    const stats = viewerStats(event.ts);
    history.record(event.viewers, event.ts, {
      cleanUsers: stats.cleanUsers,
      countMessages: (from, to) => from < messages[0].ts ? null :
        analyzer.session.records.filter((record) => record.ts > from && record.ts <= to).length,
    });
    model = buildViewerModel({
      official: event.viewers,
      stats,
      history: history.getStats(event.ts),
    });
    const botRatio = stats.activeUsers
      ? stats.suspiciousUsers / stats.activeUsers
      : 0;
    const appliedRatio = botRatio * (stats.activeUsers / (stats.activeUsers + 20));
    timeline.push({
      ts: event.ts,
      official: event.viewers,
      cleanUsers: stats.cleanUsers,
      activeUsers: stats.activeUsers,
      suspiciousUsers: stats.suspiciousUsers,
      freshUsers: stats.freshUsers,
      sessionMinutes: stats.observedMinutes,
      er: model && model.engagement ? model.engagement.percent : null,
      range: model ? model.range : null,
      oldEstimate: Math.round(event.viewers * (1 - appliedRatio)),
      verdict: model ? model.verdict : null,
      churnEvents: model && model.churn ? model.churn.churnEvents : 0,
    });
  }

  const lastTs = Math.max(
    messages[messages.length - 1].ts,
    viewerRows.length ? viewerRows[viewerRows.length - 1].ts : 0
  );
  const stats = viewerStats(lastTs);
  const historyStats = history.getStats(lastTs);
  const finalModel = lastViewer
    ? buildViewerModel({ official: lastViewer, stats, history: historyStats })
    : null;

  const topTriggers = Array.from(triggerCounts.entries()).sort(
    (a, b) => b[1] - a[1]
  );

  console.log('Twitch Chat X-Ray — live capture report');
  console.log('='.repeat(64));
  console.log(`Chat messages       : ${messages.length}`);
  console.log(`Capture span        : ${formatTime(messages[0].ts)} – ${formatTime(lastTs)} UTC`);
  console.log(`Unique accounts     : ${allUsers.size}`);
  console.log(`Fresh 2025+ accounts: ${freshUsers.size}`);
  console.log(`Accounts in an id cluster (2+ peers): ${clusterUsers.size}`);
  console.log(`Max bot score       : ${maxBotScore}`);
  console.log(
    `Scores ≥50 / 30–49 / <30: ${scoreBuckets.high} / ${scoreBuckets.mid} / ${scoreBuckets.low}`
  );
  console.log('');
  console.log('Trigger counts:');
  for (let i = 0; i < topTriggers.length; i += 1) {
    console.log(`  ${topTriggers[i][0].padEnd(18)} ${topTriggers[i][1]}`);
  }
  if (!topTriggers.length) {
    console.log('  (none)');
  }
  console.log('');

  if (viewerRows.length) {
    const values = viewerRows.map((row) => row.viewers);
    console.log(
      `Official viewers    : ${formatNumber(Math.min(...values))} – ${formatNumber(
        Math.max(...values)
      )}, median ${formatNumber(historyStats.median)}`
    );
    console.log(
      `Viewer samples      : ${viewerRows.length}, churn events ${historyStats.churnEvents}`
    );
  } else {
    console.log('Viewer samples      : none (estimate skipped)');
  }
  console.log('');

  if (finalModel) {
    console.log('Final model:');
    if (finalModel.range) {
      console.log(
        `  Range              : ${formatNumber(finalModel.range.low)} – ${formatNumber(
          finalModel.range.high
        )}`
      );
    } else {
      console.log('  Range              : not enough clean chatters');
    }
    if (finalModel.engagement) {
      console.log(
        `  ER                 : ${finalModel.engagement.percent.toFixed(1)}% (${
          finalModel.engagement.cleanChatters
        } clean / ${formatNumber(finalModel.engagement.officialViewers)})`
      );
    }
    console.log(`  Clean users (10m)  : ${stats.cleanUsers} / ${stats.activeUsers}`);
    console.log(`  Suspicious in chat : ${stats.suspiciousUsers}`);
    console.log(`  Session            : ${stats.observedMinutes} min`);
    console.log(`  Verdict            : ${finalModel.verdict.key}`);
    const finalBotRatio = stats.activeUsers
      ? stats.suspiciousUsers / stats.activeUsers
      : 0;
    const finalApplied =
      finalBotRatio * (stats.activeUsers / (stats.activeUsers + 20));
    console.log(
      `  Old formula        : ${formatNumber(
        Math.round(lastViewer * (1 - finalApplied))
      )} (bot share in chat ${(finalBotRatio * 100).toFixed(2)}%)`
    );
  }

  if (timeline.length) {
    console.log('');
    console.log('Timeline (one row per viewer sample):');
    for (let i = 0; i < timeline.length; i += 1) {
      const row = timeline[i];
      const range = row.range
        ? `${formatNumber(row.range.low)}–${formatNumber(row.range.high)}`
        : '—';
      console.log(
        `  ${formatTime(row.ts)}  viewers=${String(row.official).padStart(
          7
        )}  clean=${String(row.cleanUsers).padStart(5)}  ER=${(
          row.er === null ? '—' : row.er.toFixed(2) + '%'
        ).padStart(7)}  range=${range.padEnd(17)}  ${row.verdict ? row.verdict.key : ''}`
      );
    }
  }

  if (args.json) {
    const report = {
      generatedAt: new Date().toISOString(),
      chatFile: args.chat,
      viewersFile: args.viewers || null,
      messages: messages.length,
      firstTs: messages[0].ts,
      lastTs,
      uniqueAccounts: allUsers.size,
      freshAccounts: freshUsers.size,
      clusterAccounts: clusterUsers.size,
      maxBotScore,
      scoreBuckets,
      triggerCounts: Object.fromEntries(triggerCounts),
      viewerStats: viewerRows.length ? historyStats : null,
      finalStats: stats,
      finalModel,
      timeline,
    };
    fs.writeFileSync(args.json, JSON.stringify(report, null, 2) + '\n');
    console.log(`\nJSON report written to ${args.json}`);
  }
}

main();
