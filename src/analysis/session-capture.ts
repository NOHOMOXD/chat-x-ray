import { hasSuspiciousBehavior, isSuspicious } from '../core/chat-session.ts';
import { ID_GROUP_RULE, describeGroups, findIdGroups, recordsAt } from '../core/id-group-diagnostics.ts';
import { DEFAULTS as ANALYZER_DEFAULTS } from '../core/analyzer-config.ts';
import { WEIGHTS } from '../core/score-message.ts';
import { estimateViewerRange } from './viewer-estimate.ts';
import type { ViewerStats } from './viewer-estimate.ts';
import type { Settings } from '../config/settings-model.ts';

interface CaptureTrigger { key: string; points?: number; }

interface CaptureRecord {
  id?: string | undefined;
  ts: number;
  receivedAt?: number;
  sequence?: number;
  userKey: string;
  botScore?: number;
  triggers: CaptureTrigger[];
  botConfirmation?: { score: number } | null;
  serviceBot?: boolean;
  roleExempt?: boolean;
  unbadged?: boolean;
  color?: string;
  numericUserId?: number | null;
  isR9KDuplicate?: boolean;
  spamFlood?: boolean;
  r9kMatchId?: string | null;
  accountAgeSource?: 'api' | 'id' | 'unknown' | null;
  accountAgeDays?: number | null;
  login?: string;
  displayName?: string;
  normalized?: string;
  text?: string;
}

type CaptureSettings = Partial<Settings> & { suspiciousThreshold: number };
type CaptureModel = { official?: number | undefined; stableOfficial?: number | undefined; sampledAt?: number | undefined; stale?: boolean | undefined };
type ScaleOptions = { official?: number | undefined; stableOfficial?: number | undefined; stats: ViewerStats };

const WINDOW_MS = 600000;

export function estimateWindow(records: CaptureRecord[], stats: ViewerStats) {
  return records.filter(record => (record.receivedAt ?? record.ts) >= (stats.windowSince ?? -Infinity) &&
    (record.sequence ?? Infinity) > (stats.afterSequence ?? 0));
}

export function summarizeRecords(records: CaptureRecord[], settings: CaptureSettings, scaleOptions: ScaleOptions) {
  const authors = new Map<string, { score: number; undiscounted: number; serviceBot?: boolean | undefined; ageSource?: 'api' | 'id' | 'unknown' }>();
  const actions = { r9kOnly: 0, scoreOnly: 0, both: 0 };
  const ageSources = { api: 0, id: 0, unknown: 0 };
  for (const record of records) {
    const key = record.userKey;
    const author = authors.get(key) || { score: 0, undiscounted: 0 };
    const discount = record.triggers.find((item) => item.key === 'veteran-account');
    if (record.botConfirmation || hasSuspiciousBehavior(record)) {
      const score = Number(record.botConfirmation?.score ?? record.botScore);
      author.score = Math.max(author.score, score);
      author.undiscounted = Math.max(author.undiscounted, score - (discount?.points || 0));
    }
    author.serviceBot ||= record.serviceBot;
    author.ageSource = record.accountAgeSource === 'api' ? 'api' :
      (author.ageSource || record.accountAgeSource || 'unknown');
    authors.set(key, author);

    const scoreAction = (settings.muteSuspicious || settings.hideSuspicious) &&
      isSuspicious(record, settings.suspiciousThreshold);
    const r9kAction = settings.clientR9K && (record.isR9KDuplicate || record.spamFlood);
    if (scoreAction || r9kAction) {
      actions[scoreAction && r9kAction ? 'both' : scoreAction ? 'scoreOnly' : 'r9kOnly'] += 1;
    }
  }

  for (const author of authors.values()) {
    ageSources[author.ageSource ?? 'unknown'] += 1;
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

export function compareIdGroupScores(records: CaptureRecord[], ts: number, settings: CaptureSettings, model?: CaptureModel | null, stats?: ViewerStats) {
  const window = recordsAt(records, ts);
  const groups = findIdGroups(window);
  const ids = new Set(groups.flatMap((group) => group.memberIds));
  const authors = new Map<string, { current: number; experimental: number }>();
  for (const record of window) {
    if (record.serviceBot) continue;
    const author = authors.get(record.userKey) || { current: 0, experimental: 0 };
    authors.set(record.userKey, author);
    if (!hasSuspiciousBehavior(record)) continue;
    const eligible = record.unbadged && !record.color && !record.roleExempt;
    const confirmedFresh = eligible && record.accountAgeSource === 'api' &&
      typeof record.accountAgeDays === 'number' && Number.isFinite(record.accountAgeDays) && record.accountAgeDays < ANALYZER_DEFAULTS.freshAccountAgeDays;
    const base = record.triggers.reduce((score, item) =>
      ['id-cluster', 'fresh-account', 'veteran-account'].includes(item.key)
        ? score : score + Number(item.points), confirmedFresh ? WEIGHTS.freshAccount : 0);
    const currentPoints = record.triggers.find((item) => item.key === 'id-cluster')?.points ?? 0;
    const experimentalPoints = record.unbadged && !record.roleExempt && typeof record.numericUserId === 'number' && ids.has(record.numericUserId)
      ? WEIGHTS.idCluster : 0;
    author.current = Math.max(author.current, Math.min(100, base + currentPoints));
    author.experimental = Math.max(author.experimental, Math.min(100, base + experimentalPoints));
  }

  const threshold = settings.suspiciousThreshold;
  const crossings: Record<'both' | 'currentOnly' | 'experimentalOnly' | 'neither', string[]> = { both: [], currentOnly: [], experimentalOnly: [], neither: [] };
  for (const [author, scores] of authors) {
    const current = scores.current >= threshold;
    const experimental = scores.experimental >= threshold;
    const bucket = current ? (experimental ? 'both' : 'currentOnly')
      : experimental ? 'experimentalOnly' : 'neither';
    crossings[bucket].push(author);
  }
  const range = (cleanUsers: number) => estimateViewerRange(model?.stableOfficial, { ...stats, cleanUsers });
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
  private readonly channel: string;
  private readonly startedAt: number;
  private readonly id: string;
  private minutes: Array<{ ts: number; minute: unknown; stats: ViewerStats; model: CaptureModel | null;
    idGroupAudit: ReturnType<typeof compareIdGroupScores>; diagnostics: ReturnType<typeof summarizeRecords> | null }> = [];
  viewerSamples: Array<{ ts: number; value: number; clean?: number | null }> = [];
  events: Array<Record<string, unknown>> = [];
  private settings: Array<{ ts: number; value: CaptureSettings }> = [];
  private lastMinute: number;
  private lastModel: CaptureModel | null = null;

  constructor(channel: string, now: number) {
    this.channel = channel;
    this.startedAt = now;
    this.id = globalThis.crypto.randomUUID();
    this.lastMinute = now;
  }

  recordModel(model: CaptureModel | null) {
    if (model && !model.stale && typeof model.sampledAt === 'number' && model.sampledAt >= this.startedAt) {
      this.lastModel = model;
    }
  }

  updateSettings(settings: CaptureSettings, ts: number) {
    const current = { ...settings };
    const prev = this.settings.at(-1)?.value;
    if (!prev || Object.keys(current).some((key) => Reflect.get(current, key) !== Reflect.get(prev, key))) {
      this.settings.push({ ts, value: current });
    }
  }

  window(now: number, records: CaptureRecord[]) {
    const start = Math.max(this.startedAt, now - WINDOW_MS);
    return records.filter((record) => record.ts >= start && record.ts <= now);
  }

  observe(now: number, stats: ViewerStats, model: CaptureModel | null, records: CaptureRecord[], settings: CaptureSettings, minute: unknown) {
    this.recordModel(model);
    if (model?.stale) {
      model = null;
    }
    if (now - this.lastMinute < 60000) {
      return;
    }
    this.lastMinute += Math.floor((now - this.lastMinute) / 60000) * 60000;
    const window = estimateWindow(this.window(now, records), stats);
    this.minutes.push({
      ts: now,
      minute,
      stats,
      model,
      idGroupAudit: compareIdGroupScores(window, now, settings, model, stats),
      diagnostics: Math.min(now - this.startedAt, Number(stats.sessionMs)) >= WINDOW_MS
        ? summarizeRecords(window, settings, {
            official: model?.official, stableOfficial: model?.stableOfficial, stats,
          })
        : null,
    });
  }

  snapshot(now: number, records: CaptureRecord[], stats: ViewerStats, model: CaptureModel | null, settings: CaptureSettings) {
    this.recordModel(model);
    const messages = this.window(now, records).map(({ login, displayName, normalized, ...record }) => ({
      ...record, suspicious: isSuspicious(record, settings.suspiciousThreshold),
    }));
    const window = estimateWindow(messages, stats);
    return {
      schemaVersion: 3,
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
        durationMs: Math.min(WINDOW_MS, now - this.startedAt, Number(stats.sessionMs)),
        stats,
        model: model?.stale ? null : model,
        messages,
        idGroupAudit: compareIdGroupScores(window, now, settings, model, stats),
        diagnostics: summarizeRecords(window, settings, {
          official: model?.official, stableOfficial: model?.stableOfficial, stats,
        }),
      },
    };
  }
}
