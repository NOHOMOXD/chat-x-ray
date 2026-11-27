import { mergeIntervals } from './observation-clock.ts';

export interface TimedSample {
  ts: number;
  er: number;
  [field: string]: unknown;
}

export interface HistoryEvent {
  kind: string;
  ts: number;
  bucketStart?: number;
  id?: string;
  from?: unknown;
  to?: unknown;
  authors?: number;
  recoveredAt?: number;
  closedAt?: number;
  lowTs?: number | undefined;
  delta?: number | undefined;
  [field: string]: unknown;
}

export interface GroupWindow {
  ts: number;
  groups: Array<{ memberIds: number[] }>;
  [field: string]: unknown;
}

export interface SavedModel {
  range?: unknown;
  stale?: boolean | undefined;
  recentAge?: unknown;
  sampledAt: number;
  historyProfile?: string | undefined;
  engagement?: { measurable?: boolean } | null | undefined;
  [field: string]: unknown;
}

export interface Checkpoint {
  bonuses?: Record<string, Record<string, unknown>>;
  confirmed?: Record<string, unknown>;
  intervals?: { chat?: unknown[]; viewer?: unknown[] };
  events?: HistoryEvent[];
  groups?: GroupWindow[];
  lastRangeModel?: SavedModel | null;
  lastViewerModel?: SavedModel | null;
}

const MINUTE = 60000;
const MAX_GROUP_WINDOWS = 240;

function minuteRecords<T extends { ts: number }>(previous: T[], next: T[], select: (a: T, b: T) => T) {
  const buckets = new Map();
  for (const item of [...previous, ...next]) {
    if (!Number.isFinite(item.ts)) continue;
    const minute = Math.floor(item.ts / MINUTE);
    const existing = buckets.get(minute);
    buckets.set(minute, existing ? select(existing, item) : item);
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts);
}

export function mergeSamples(previous: TimedSample[], next: TimedSample[]) {
  return minuteRecords(previous, next.filter(({ er }) => Number.isFinite(er) && er >= 0),
    (a, b) => a.ts <= b.ts ? a : b);
}

function sameEvent(a: HistoryEvent, b: HistoryEvent) {
  if (a.kind !== b.kind) return false;
  if (a.bucketStart !== undefined || b.bucketStart !== undefined) {
    return a.bucketStart === b.bucketStart;
  }
  if (a.id && b.id) return a.id === b.id;
  if (a.ts === b.ts) return true;
  // Independent tabs may sample the same viewer change a few seconds apart.
  return ['viewer-outflow', 'surge', 'churn'].includes(a.kind) &&
    a.from === b.from && Math.abs(a.ts - b.ts) <= 15000;
}

function coalesceEvents(previous: HistoryEvent[], next: HistoryEvent[]) {
  const merged = [...previous];
  for (const event of next) {
    if (!event.kind || !Number.isFinite(event.ts)) continue;
    const index = merged.findIndex((candidate) => sameEvent(candidate, event));
    if (index < 0) {
      merged.push(event);
      continue;
    }
    const existing = merged[index];
    if (!existing) continue;
    if (event.kind === 'viewer-outflow') {
      const low = Number(event.to) < Number(existing.to) ? event : existing;
      const final = existing.recoveredAt || (existing.closedAt || 0) > (event.closedAt || 0) && !event.recoveredAt
        ? existing : event;
      merged[index] = {
        ...final,
        ts: Math.min(existing.ts, event.ts),
        to: low.to,
        lowTs: low.lowTs,
        delta: low.delta,
      };
    } else if ((event.kind === 'surge' && Number(event.to) > Number(existing.to)) || Number(event.authors) > Number(existing.authors)) {
      merged[index] = event;
    }
  }
  return merged.sort((a, b) => a.ts - b.ts);
}

function lastModel(a: SavedModel | null | undefined, b: SavedModel | null | undefined) {
  if (!b || b.stale) return a ?? null;
  if (a?.historyProfile === b.historyProfile && a?.engagement?.measurable &&
      !b.engagement?.measurable) return a;
  return !a || a.sampledAt <= b.sampledAt ? b : a;
}

function groupCoverage(snapshot: GroupWindow) {
  return snapshot.groups.reduce((total, group) => total + group.memberIds.length, 0);
}

export function checkpointMerge(current: Checkpoint = {}, update: Checkpoint = {}) {
  return {
    bonuses: Object.fromEntries([...new Set([...Object.keys(current.bonuses ?? {}), ...Object.keys(update.bonuses ?? {})])].map(id =>
      [id, { ...update.bonuses?.[id], ...current.bonuses?.[id] }])),
    confirmed: { ...update.confirmed, ...current.confirmed },
    intervals: {
      chat: mergeIntervals([...(current.intervals?.chat ?? []), ...(update.intervals?.chat ?? [])]),
      viewer: mergeIntervals([...(current.intervals?.viewer ?? []), ...(update.intervals?.viewer ?? [])]),
    },
    events: coalesceEvents(current.events ?? [], update.events ?? []),
    groups: minuteRecords(current.groups ?? [], update.groups ?? [],
      (a, b) => groupCoverage(a) >= groupCoverage(b) ? a : b).slice(-MAX_GROUP_WINDOWS),
    lastRangeModel: [current.lastRangeModel, current.lastViewerModel, update.lastRangeModel, update.lastViewerModel]
      .filter((model): model is SavedModel => Boolean(model?.range && !model.stale && model.recentAge == null))
      .sort((a, b) => b.sampledAt - a.sampledAt)[0] ?? null,
    lastViewerModel: lastModel(current.lastViewerModel, update.lastViewerModel),
  };
}


function isExternalObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHistoryEvent(value: unknown): value is HistoryEvent {
  return isExternalObject(value) && typeof value.kind === 'string' &&
    typeof value.ts === 'number' && Number.isFinite(value.ts);
}

function isGroupWindow(value: unknown): value is GroupWindow {
  return isExternalObject(value) && typeof value.ts === 'number' && Number.isFinite(value.ts) &&
    Array.isArray(value.groups) && value.groups.every(group => isExternalObject(group) &&
      Array.isArray(group.memberIds) && group.memberIds.every((id: unknown) => typeof id === 'number'));
}

function savedModel(value: unknown): SavedModel | null {
  if (!isExternalObject(value) || typeof value.sampledAt !== 'number' || !Number.isFinite(value.sampledAt)) return null;
  return { ...value, sampledAt: value.sampledAt };
}

/** Recover valid fields of an older or partially damaged checkpoint. */
export function readCheckpoint(value: Record<string, unknown>): Checkpoint {
  const intervals = isExternalObject(value.intervals) ? value.intervals : {};
  const bonuses: Record<string, Record<string, unknown>> = {};
  if (isExternalObject(value.bonuses)) {
    for (const [id, entries] of Object.entries(value.bonuses)) {
      if (isExternalObject(entries)) bonuses[id] = entries;
    }
  }
  return {
    bonuses,
    confirmed: isExternalObject(value.confirmed) ? value.confirmed : {},
    intervals: {
      chat: Array.isArray(intervals.chat) ? intervals.chat : [],
      viewer: Array.isArray(intervals.viewer) ? intervals.viewer : [],
    },
    events: Array.isArray(value.events) ? value.events.filter(isHistoryEvent) : [],
    groups: Array.isArray(value.groups) ? value.groups.filter(isGroupWindow) : [],
    lastRangeModel: savedModel(value.lastRangeModel),
    lastViewerModel: savedModel(value.lastViewerModel),
  };
}

