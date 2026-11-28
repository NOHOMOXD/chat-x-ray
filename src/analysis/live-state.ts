// Short-lived reload checkpoints are owned by the extension background page.
// Only numeric measurements and the fields needed for rolling counts travel
// here. A full model also contains message and ID-group diagnostics.
import { calculateChatStats, DEFAULTS } from '../core/chat-session.ts';
import { isSavedLiveRow, packLiveRow, unpackLiveRow } from './live-rows.ts';
import { mergeIntervals } from './observation-clock.ts';
import type { ChatRecord } from '../core/chat-session.ts';
import type { HistoryEvent } from './broadcast-checkpoint.ts';

interface BroadcastIdentity {
  channel: string;
  id?: string | null;
  startedAt?: number | null;
}

interface ViewerModel {
  input?: unknown;
  range?: { low: number; high: number } | null | undefined;
  sampledAt?: number | undefined;
  historyProfile?: unknown;
  recentAge?: number | null | undefined;
  stale?: boolean | undefined;
}

interface LiveSnapshotInput {
  channel: string;
  identity: BroadcastIdentity | null;
  now?: number;
  chat: unknown;
  viewer: unknown;
  model: ViewerModel | null;
  formula?: unknown;
  profile?: unknown;
  records?: Array<ChatRecord & { botScore: number }>;
  events?: Array<Record<string, unknown>>;
  confirmed?: Record<string, unknown>;
  bonuses?: Record<string, unknown>;
  samples?: Array<{ ts: number; value: number; clean?: number | null }>;
}


export const LIVE_PERSIST_INTERVAL_MS = 10000;
export const RESUME_GAP_MS = 120000;

export function resumedWindow(intervals: unknown, now: number) {
  let start = now;
  let duration = 0;
  for (const [from, to] of mergeIntervals(intervals).reverse()) {
    const end = Math.min(to, now);
    if (start - end > RESUME_GAP_MS) break;
    const amount = Math.min(WINDOW_MS - duration, Math.max(0, end - from));
    start = end - amount;
    duration += amount;
    if (duration >= WINDOW_MS) break;
  }
  return { start, duration };
}
export const MAX_LIVE_AGE_MS = 5 * 60000;
const WINDOW_MS = 10 * 60000;
const VERSION = 2;

export function broadcastLiveKey(identity: BroadcastIdentity | null | undefined) {
  if (!identity?.channel) return null;
  if (identity.id) return identity.channel + ':id:' + identity.id;
  return Number.isFinite(identity.startedAt) ? identity.channel + ':start:' + identity.startedAt : null;
}

export function conflictingBroadcasts(a: BroadcastIdentity | null | undefined, b: BroadcastIdentity | null | undefined) {
  if (!a || !b) return false;
  return a.channel !== b.channel || Boolean(a.id && b.id && a.id !== b.id) ||
    Boolean(a.startedAt && b.startedAt && a.startedAt !== b.startedAt);
}

export function sameLiveBroadcast(a: BroadcastIdentity | null | undefined, b: BroadcastIdentity | null | undefined) {
  return Boolean(a && b && !conflictingBroadcasts(a, b) &&
    ((a.id && a.id === b.id) || (a.startedAt && a.startedAt === b.startedAt)));
}

function coverage(intervals: unknown, now: number) {
  return mergeIntervals(intervals).filter(([start, end]) => start >= 0 && end <= now);
}

export function savedRange(input: unknown, now: number) {
  if (!isRecord(input) || !isRecord(input.range) || input.recentAge != null || input.stale ||
      typeof input.sampledAt !== 'number' || !Number.isFinite(input.sampledAt) || input.sampledAt > now) return null;
  const { low, high } = input.range;
  if (typeof low !== 'number' || typeof high !== 'number' || !Number.isFinite(low) ||
      !Number.isFinite(high) || low < 0 || high < low) return null;
  return { sampledAt: input.sampledAt, historyProfile: input.historyProfile, range: { low, high } };
}

// Restored rows are only a display window. The formula, scoring and exports of
// newly received messages keep their current socket boundary and real inputs.
export function observedWindow(records: ChatRecord[], restoredRows: ChatRecord[], now: number, threshold: number, start = now - WINDOW_MS) {
  return calculateChatStats([...restoredRows, ...records],
    { ...DEFAULTS, recentWindowMs: now - start, suspiciousThreshold: threshold }, now, start);
}

const eventNumbers = ['ts', 'bucketStart', 'messages', 'authors', 'from', 'to', 'delta', 'startedAt',
  'confirmedAt', 'closedAt', 'recoveredAt', 'fromTs', 'lowTs', 'durationMs', 'resumedAt', 'viewers'];
function eventSummary(event: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = { kind: event.kind };
  for (const field of eventNumbers) if (Number.isFinite(event[field])) summary[field] = event[field];
  for (const field of ['status', 'reason', 'id']) {
    const value = event[field];
    if (typeof value === 'string' && value.length <= 100) summary[field] = value;
  }
  if (event.kind === 'room-mode') {
    for (const side of ['from', 'to']) {
      const source = event[side];
      const mode = source && typeof source === 'object' ? source as Record<string, unknown> : {};
      summary[side] = Object.fromEntries(['slow', 'followers', 'unique', 'emotes', 'subscribers']
        .filter(key => Number.isFinite(mode[key])).map(key => [key, mode[key]]));
    }
  }
  if (event.raid) summary.raid = eventSummary(event.raid as Record<string, unknown>);
  return summary;
}

export function createLiveSnapshot({ channel, identity, now = Date.now(), chat, viewer, model, formula = [], profile, records = [],
  events = [], confirmed = {}, bonuses = {}, samples = [] }: LiveSnapshotInput) {
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) return null;
  const formulaIntervals = coverage(formula, now);
  const start = formulaIntervals.length ? resumedWindow(formulaIntervals, now).start : now - WINDOW_MS;
  const window = records.filter(record => record.ts >= start && record.ts <= now);
  return {
    v: VERSION, channel, identity: identity && { channel, id: identity.id ?? null, startedAt: identity.startedAt ?? null },
    savedAt: now, chat: coverage(chat, now), viewer: coverage(viewer, now), model: savedRange(model, now),
    formula: coverage(formula, now).filter(([, end]) => end >= start), profile,
    rows: window.map(packLiveRow),
    events: events.map(eventSummary), confirmed, bonuses,
    samples: samples.filter(sample => sample.ts >= start && sample.ts <= now)
      .map(({ ts, value, clean }) => ({ ts, value, clean })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBroadcastIdentity(value: unknown): value is BroadcastIdentity {
  return isRecord(value) && typeof value.channel === 'string' &&
    (value.id == null || typeof value.id === 'string') &&
    (value.startedAt == null || typeof value.startedAt === 'number' && Number.isFinite(value.startedAt));
}

function isHistoryEvent(value: unknown): value is HistoryEvent {
  return isRecord(value) && typeof value.kind === 'string' &&
    typeof value.ts === 'number' && Number.isFinite(value.ts);
}

function isViewerSample(value: unknown): value is { ts: number; value: number; clean?: number | null } {
  return isRecord(value) && typeof value.ts === 'number' && Number.isFinite(value.ts) &&
    typeof value.value === 'number' && Number.isFinite(value.value) &&
    (value.clean == null || typeof value.clean === 'number' && Number.isFinite(value.clean));
}

export function restoreLiveSnapshot(input: unknown, channel: string, identity: BroadcastIdentity | null, now = Date.now()) {
  if (!isRecord(input)) return null;
  const snapshot = input;
  const savedIdentity = snapshot.identity;
  if (savedIdentity != null && !isBroadcastIdentity(savedIdentity)) return null;
  const restoredIdentity = isBroadcastIdentity(savedIdentity) ? savedIdentity : null;
  if (snapshot.v !== VERSION || snapshot.channel !== channel ||
      typeof snapshot.savedAt !== 'number' || !Number.isFinite(snapshot.savedAt) || snapshot.savedAt > now || now - snapshot.savedAt > MAX_LIVE_AGE_MS ||
      conflictingBroadcasts(identity, restoredIdentity) ||
      (identity?.startedAt && identity.startedAt > snapshot.savedAt)) return null;
  const savedRows: unknown[] = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const formulaIntervals = coverage(snapshot.formula, now);
  const start = formulaIntervals.length ? resumedWindow(formulaIntervals, now).start : now - WINDOW_MS;
  const rows = savedRows.filter(isSavedLiveRow)
    .filter(row => row[1] >= start && row[1] <= now).map(unpackLiveRow);
  return {
    ...snapshot, identity: restoredIdentity, savedAt: snapshot.savedAt, rows,
    chat: coverage(snapshot.chat, now), viewer: coverage(snapshot.viewer, now),
    formula: coverage(snapshot.formula, now), model: savedRange(snapshot.model, now),
    events: Array.isArray(snapshot.events) ? snapshot.events.filter(isHistoryEvent) : [],
    samples: Array.isArray(snapshot.samples) ? snapshot.samples.filter(isViewerSample) : [],
    confirmed: isRecord(snapshot.confirmed) ? snapshot.confirmed : {},
    bonuses: isRecord(snapshot.bonuses) ? snapshot.bonuses : {},
    requireIdentity: snapshot.requireIdentity === true,
    profile: typeof snapshot.profile === 'string' ? snapshot.profile : undefined,
  };
}
