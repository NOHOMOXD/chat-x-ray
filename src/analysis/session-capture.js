import { ID_GROUP_RULE, describeGroups, findIdGroups, recordsAt } from '../core/id-group-diagnostics.js';
import { DEFAULTS as ANALYZER_DEFAULTS, WEIGHTS } from '../core/analyzer.js';
import { estimateViewerRange } from './viewer-estimate.js';

const WINDOW_MS = 600000;

export function summarizeRecords(records, settings, scaleOptions) {
  const authors = new Map();
  const actions = { r9kOnly: 0, scoreOnly: 0, both: 0 };
  const ageSources = { api: 0, id: 0, unknown: 0 };
  for (const record of records) {
    const key = record.userKey;
    const author = authors.get(key) || { score: 0, undiscounted: 0 };
    const discount = record.triggers.find((item) => item.key === 'veteran-account');
    author.score = Math.max(author.score, record.botScore);
    author.undiscounted = Math.max(author.undiscounted, record.botScore - (discount?.points || 0));
    author.serviceBot ||= record.serviceBot;
    author.ageSource = record.accountAgeSource === 'api' ? 'api' :
      (author.ageSource || record.accountAgeSource || 'unknown');
    authors.set(key, author);

    const scoreAction = (settings.muteSuspicious || settings.hideSuspicious) &&
      record.botScore >= settings.suspiciousThreshold;
    const r9kAction = settings.clientR9K && (record.isR9KDuplicate || record.spamFlood);
    if (scoreAction || r9kAction) {
      actions[scoreAction && r9kAction ? 'both' : scoreAction ? 'scoreOnly' : 'r9kOnly'] += 1;
    }
  }

  for (const author of authors.values()) {
    ageSources[author.ageSource] += 1;
  }
  const eligible = [...authors.values()].filter((author) => !author.serviceBot);
  const thresholds = [10, 25, 30, 50].map((threshold) => {
    const cleanUsers = eligible.filter((author) => author.score < threshold).length;
    return {
      threshold,
      cleanUsers,
      er: scaleOptions.official ? cleanUsers / scaleOptions.official * 100 : null,
      range: estimateViewerRange(scaleOptions.stableOfficial, {
        ...scaleOptions.stats, cleanUsers,
      }),
    };
  });
  return {
    thresholds,
    actions,
    ageSources,
    ageDiscountCrossings: eligible.filter(({ score, undiscounted }) =>
      score < settings.suspiciousThreshold && undiscounted >= settings.suspiciousThreshold).length,
  };
}

export function compareIdGroupScores(records, ts, settings, model, stats) {
  const window = recordsAt(records, ts);
  const groups = findIdGroups(window);
  const ids = new Set(groups.flatMap((group) => group.memberIds));
  const authors = new Map();
  for (const record of window) {
    if (record.serviceBot) continue;
    const author = authors.get(record.userKey) || { current: 0, experimental: 0 };
    const eligible = record.unbadged && !record.color && !record.roleExempt;
    const confirmedFresh = eligible && record.accountAgeSource === 'api' &&
      Number.isFinite(record.accountAgeDays) && record.accountAgeDays < ANALYZER_DEFAULTS.freshAccountAgeDays;
    const base = record.triggers.reduce((score, item) =>
      ['id-cluster', 'fresh-account', 'veteran-account'].includes(item.key)
        ? score : score + item.points, confirmedFresh ? WEIGHTS.freshAccount : 0);
    const currentPoints = record.triggers.find((item) => item.key === 'id-cluster')?.points ?? 0;
    const experimentalPoints = record.unbadged && !record.roleExempt && ids.has(record.numericUserId)
      ? WEIGHTS.idCluster : 0;
    author.current = Math.max(author.current, Math.min(100, base + currentPoints));
    author.experimental = Math.max(author.experimental, Math.min(100, base + experimentalPoints));
    authors.set(record.userKey, author);
  }

  const threshold = settings.suspiciousThreshold;
  const crossings = { both: [], currentOnly: [], experimentalOnly: [], neither: [] };
  for (const [author, scores] of authors) {
    const current = scores.current >= threshold;
    const experimental = scores.experimental >= threshold;
    const bucket = current ? (experimental ? 'both' : 'currentOnly')
      : experimental ? 'experimentalOnly' : 'neither';
    crossings[bucket].push(author);
  }
  const range = (cleanUsers) => estimateViewerRange(model?.stableOfficial, { ...stats, cleanUsers });
  return {
    ts, rule: ID_GROUP_RULE, groups: describeGroups(groups, window),
    comparison: {
      threshold, crossings,
      currentRange: range(crossings.neither.length + crossings.experimentalOnly.length),
      experimentalRange: range(crossings.neither.length + crossings.currentOnly.length),
    },
  };
}

export class SessionCapture {
  constructor(channel, now) {
    this.channel = channel;
    this.startedAt = now;
    this.id = globalThis.crypto.randomUUID();
    this.minutes = [];
    this.viewerSamples = [];
    this.events = [];
    this.settings = [];
    this.lastMinute = now;
    this.lastModel = null;
  }

  recordModel(model) {
    if (model && !model.stale && model.sampledAt >= this.startedAt) {
      this.lastModel = model;
    }
  }

  updateSettings(settings, ts) {
    const current = { ...settings };
    const prev = this.settings.at(-1)?.value;
    if (!prev || Object.keys(current).some((key) => current[key] !== prev[key])) {
      this.settings.push({ ts, value: current });
    }
  }

  window(now, records) {
    const start = Math.max(this.startedAt, now - WINDOW_MS);
    return records.filter((record) => record.ts >= start && record.ts <= now);
  }

  observe(now, stats, model, records, settings, minute) {
    this.recordModel(model);
    if (model?.stale) {
      model = null;
    }
    if (now - this.lastMinute < 60000) {
      return;
    }
    this.lastMinute += Math.floor((now - this.lastMinute) / 60000) * 60000;
    const window = this.window(now, records);
    this.minutes.push({
      ts: now,
      minute,
      stats,
      model,
      idGroupAudit: compareIdGroupScores(records, now, settings, model, stats),
      diagnostics: Math.min(now - this.startedAt, stats.sessionMs) >= WINDOW_MS
        ? summarizeRecords(window, settings, {
            official: model?.official, stableOfficial: model?.stableOfficial, stats,
          })
        : null,
    });
  }

  snapshot(now, records, stats, model, settings) {
    this.recordModel(model);
    const window = this.window(now, records).map(({ login, displayName, normalized, ...record }) => record);
    return {
      schemaVersion: 1,
      id: this.id,
      channel: this.channel,
      startedAt: new Date(this.startedAt).toISOString(),
      exportedAt: new Date(now).toISOString(),
      settings: this.settings,
      minutes: this.minutes,
      viewerSamples: this.viewerSamples,
      events: this.events.map((event) => ({ ...event })),
      lastViewerModel: this.lastModel,
      current: {
        durationMs: Math.min(WINDOW_MS, now - this.startedAt, stats.sessionMs),
        stats,
        model: model?.stale ? null : model,
        messages: window,
        idGroupAudit: compareIdGroupScores(records, now, settings, model, stats),
        diagnostics: summarizeRecords(window, settings, {
          official: model?.official, stableOfficial: model?.stableOfficial, stats,
        }),
      },
    };
  }
}
