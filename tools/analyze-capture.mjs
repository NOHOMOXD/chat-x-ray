#!/usr/bin/env node
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
import { parsePrivmsg } from '../src/irc-parser.js';
import { Analyzer } from '../src/analyzer.js';
import { ViewerHistory } from '../src/viewer-history.js';
import { buildViewerModel } from '../src/viewer-estimate.js';
import { formatNumber } from '../src/ui-utils.js';

function parseArgs(argv) {
  const args = { chat: '', viewers: '', json: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--chat') {
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.chat) {
    console.error(
      'Usage: node tools/analyze-capture.mjs --chat <chat.jsonl> [--viewers <viewers.jsonl>] [--json <out.json>]'
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
    const message = parsePrivmsg(row.line, row.ts);
    if (!message) {
      continue;
    }
    // Two overlapping captures can contain the same IRC message id.
    if (message.id) {
      if (seenMessageIds.has(message.id)) {
        continue;
      }
      seenMessageIds.add(message.id);
    }
    messages.push({ ts: Number(row.ts), message });
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
    history.record(event.viewers, event.ts);
    const stats = analyzer.getStats(event.ts);
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
  const stats = analyzer.getStats(lastTs);
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
    console.log(`  Verdict            : ${finalModel.verdict.label}`);
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
