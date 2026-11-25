import { callStorage, getStorageArea } from '../platform/browser-api.js';
import { medianNumber } from './er-baseline.js';

export const BROADCAST_HISTORY_KEY = 'tcx:broadcastHistory:v1';
export const HISTORY_CLEAR_KEY = 'tcx:broadcastHistory:clearedAt';
export const SCORING_RULE_VERSION = 4;
const MAX_BROADCASTS_PER_CHANNEL = 20;
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const MINUTE = 60000;
const MAX_GROUP_WINDOWS = 240;

export function broadcastProfile(settings) {
  return [SCORING_RULE_VERSION, Number(settings.suspiciousThreshold),
    Number(Boolean(settings.accountAgeLookup)), settings.roomProfile ?? 'unknown'].join(':');
}

export function broadcastKey({ channel, id, startedAt }) {
  return channel + ':' + (id ? 'id:' + id : 'start:' + startedAt);
}

export function mergeIntervals(intervals) {
  const sorted = intervals.filter(([start, end]) =>
    Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort(([a], [b]) => a - b);
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(end, last[1]);
    else merged.push([start, end]);
  }
  return merged;
}

function minuteRecords(previous, next, select) {
  const buckets = new Map();
  for (const item of [...previous, ...next]) {
    if (!Number.isFinite(item.ts)) continue;
    const minute = Math.floor(item.ts / MINUTE);
    const existing = buckets.get(minute);
    buckets.set(minute, existing ? select(existing, item) : item);
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts);
}

function mergeSamples(previous, next) {
  return minuteRecords(previous, next.filter(({ er }) => Number.isFinite(er) && er >= 0),
    (a, b) => a.ts <= b.ts ? a : b);
}

function sameEvent(a, b) {
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

function coalesceEvents(previous, next) {
  const merged = [...previous];
  for (const event of next) {
    if (!event.kind || !Number.isFinite(event.ts)) continue;
    const index = merged.findIndex((candidate) => sameEvent(candidate, event));
    if (index < 0) {
      merged.push(event);
      continue;
    }
    const existing = merged[index];
    if (event.kind === 'viewer-outflow') {
      const low = event.to < existing.to ? event : existing;
      const final = existing.recoveredAt || (existing.closedAt || 0) > (event.closedAt || 0) && !event.recoveredAt
        ? existing : event;
      merged[index] = {
        ...final,
        ts: Math.min(existing.ts, event.ts),
        to: low.to,
        lowTs: low.lowTs,
        delta: low.delta,
      };
    } else if ((event.kind === 'surge' && event.to > existing.to) || event.authors > existing.authors) {
      merged[index] = event;
    }
  }
  return merged.sort((a, b) => a.ts - b.ts);
}

function lastModel(a, b) {
  if (!b || b.stale) return a ?? null;
  if (a?.historyProfile === b.historyProfile && a?.engagement?.measurable &&
      !b.engagement?.measurable) return a;
  return !a || a.sampledAt <= b.sampledAt ? b : a;
}

function groupCoverage(snapshot) {
  return snapshot.groups.reduce((total, group) => total + group.memberIds.length, 0);
}

export function checkpointMerge(current = {}, update = {}) {
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
      .filter(model => model?.range && !model.stale && model.recentAge == null)
      .sort((a, b) => b.sampledAt - a.sampledAt)[0] ?? null,
    lastViewerModel: lastModel(current.lastViewerModel, update.lastViewerModel),
  };
}

function quantile(sorted, fraction) {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

export function broadcastRelation(er, baseline) {
  if (!Number.isFinite(er) || !Number.isFinite(baseline?.low) || !Number.isFinite(baseline.high)) return null;
  if (er < baseline.low) return 'low';
  if (er > baseline.high) return 'high';
  return 'typical';
}

function sameBroadcast(a, b) {
  if (a.channel !== b.channel) return false;
  if (a.id && b.id) return a.id === b.id;
  return Number.isFinite(a.startedAt) && a.startedAt === b.startedAt;
}

function startedAt(broadcast) {
  return broadcast.startedAt ?? broadcast.firstObservedAt ?? broadcast.updatedAt ?? Date.now();
}

function priorBroadcast(candidate, identity) {
  return !sameBroadcast(candidate, identity) && startedAt(candidate) < startedAt(identity);
}

function historySnapshot(records, identity, settings) {
  const profile = broadcastProfile(settings);
  const current = records.filter((item) => sameBroadcast(item, identity));
  const earlier = records.filter((item) => item.channel === identity.channel && priorBroadcast(item, current[0] ?? identity))
    .sort((a, b) => startedAt(b) - startedAt(a));
  const values = earlier.map((item) => medianNumber(item.profiles[profile]?.map(({ er }) => er)))
    .filter(Number.isFinite);
  let checkpoint = null;
  if (current.length) {
    checkpoint = current.reduce((combined, item) => checkpointMerge(combined, item.checkpoint), {});
    checkpoint.samples = current.reduce((all, item) =>
      mergeSamples(all, item.profiles[profile] ?? []), []);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const hasRange = values.length >= 5;
  return {
    checkpoint,
    baseline: values.length ? {
      er: hasRange ? medianNumber(values) : values[0],
      lastEr: values[0],
      sessions: values.length,
      low: hasRange ? quantile(sorted, 0.25) : null,
      high: hasRange ? quantile(sorted, 0.75) : null,
    } : null,
    history: records.filter((item) => priorBroadcast(item, current[0] ?? identity) &&
      (item.channel === identity.channel || item.checkpoint?.groups?.some((observation) => observation.groups?.length)))
      .sort((a, b) => startedAt(b) - startedAt(a))
      .slice(0, MAX_BROADCASTS_PER_CHANNEL).map(({ channel, id, startedAt, checkpoint }) => ({
      channel, id: id || broadcastKey({ channel, startedAt }), startedAt,
      confirmed: checkpoint.confirmed, groupObservations: checkpoint.groups,
    })),
  };
}

function retainChannel(records) {
  const retainedProfiles = new Map();
  const newestFirst = records.sort((a, b) => startedAt(b) - startedAt(a));
  const retained = [];
  for (const [index, record] of newestFirst.entries()) {
    const profiles = {};
    for (const [key, samples] of Object.entries(record.profiles)) {
      const count = retainedProfiles.get(key) ?? 0;
      if (count >= MAX_BROADCASTS_PER_CHANNEL || !samples.length) continue;
      retainedProfiles.set(key, count + 1);
      profiles[key] = samples;
    }
    if (index < MAX_BROADCASTS_PER_CHANNEL) {
      retained.push({ ...record, profiles });
    } else if (Object.keys(profiles).length) {
      retained.push({ ...record, profiles, checkpoint: checkpointMerge() });
    }
  }
  return retained;
}

function afterClear(update, clearedAt) {
  if (!clearedAt) return update;
  const newer = (items) => (items ?? []).filter((item) => item.ts > clearedAt);
  const covered = (items) => (items ?? []).map(([from, to]) => [Math.max(from, clearedAt), to]);
  return {
    intervals: { chat: covered(update.intervals?.chat), viewer: covered(update.intervals?.viewer) },
    // ER and group observations each describe a full rolling window.
    samples: (update.samples ?? []).filter((item) => item.ts - 600000 >= clearedAt),
    groups: (update.groups ?? []).filter((item) => item.ts - 600000 >= clearedAt),
    bonuses: Object.fromEntries(Object.entries(update.bonuses ?? {}).map(([id, reasons]) =>
      [id, Object.fromEntries(Object.entries(reasons).filter(([, entry]) => entry.ts > clearedAt))])),
    confirmed: Object.fromEntries(Object.entries(update.confirmed ?? {}).filter(([, value]) => value.ts > clearedAt)),
    events: newer(update.events),
    lastViewerModel: update.lastViewerModel?.sampledAt - 600000 >= clearedAt ? update.lastViewerModel : null,
  };
}

function validIdentity(identity) {
  return identity?.channel && (identity.id || Number.isFinite(identity.startedAt));
}

export class BroadcastHistory {
  constructor({ storage = getStorageArea(), locks = globalThis.navigator?.locks } = {}) {
    this.storage = storage;
    this.locks = locks;
    this.pending = Promise.resolve();
    this.memory = [];
    this.clearedAt = 0;
  }

  async read() {
    if (!this.storage) return this.memory;
    const result = await callStorage(this.storage.get.bind(this.storage), [BROADCAST_HISTORY_KEY, HISTORY_CLEAR_KEY]);
    this.clearedAt = result?.[HISTORY_CLEAR_KEY] || 0;
    return Array.isArray(result?.[BROADCAST_HISTORY_KEY]) ? result[BROADCAST_HISTORY_KEY] : [];
  }

  async write(records) {
    if (!this.storage) {
      this.memory = records;
      return;
    }
    await callStorage(this.storage.set.bind(this.storage), { [BROADCAST_HISTORY_KEY]: records, [HISTORY_CLEAR_KEY]: this.clearedAt });
  }

  transaction(operation) {
    // All content scripts for Twitch share the Web Locks origin; the actual
    // data belongs to extension storage, never to Twitch storage.
    if (this.storage && this.locks?.request) {
      return this.locks.request(BROADCAST_HISTORY_KEY, operation);
    }
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  async load(identity, settings) {
    if (!validIdentity(identity)) return { checkpoint: null, baseline: null, history: [] };
    return { ...historySnapshot(await this.read(), identity, settings), clearedAt: this.clearedAt };
  }

  async save(identity, settings, update) {
    if (!validIdentity(identity)) return this.load(identity, settings);
    return this.transaction(async () => {
      const records = await this.read();
      const matches = records.filter((item) => sameBroadcast(item, identity));
      const profiles = {};
      let checkpoint = {};
      for (const existing of matches) {
        checkpoint = checkpointMerge(checkpoint, existing.checkpoint);
        for (const [profile, samples] of Object.entries(existing.profiles)) {
          profiles[profile] = mergeSamples(profiles[profile] ?? [], samples);
        }
      }
      const profile = broadcastProfile(settings);
      const next = afterClear(update, this.clearedAt);
      profiles[profile] = mergeSamples(profiles[profile] ?? [], next.samples ?? []);
      const current = {
        ...matches[0], ...identity,
        id: identity.id ?? matches.find((item) => item.id)?.id ?? null,
        startedAt: identity.startedAt ?? matches.find((item) => Number.isFinite(item.startedAt))?.startedAt ?? null,
        firstObservedAt: Math.min(...matches.map(startedAt), startedAt(identity)),
        profiles, checkpoint: checkpointMerge(checkpoint, next), updatedAt: Date.now(),
      };
      const remaining = records.filter((item) => !matches.includes(item));
      const channelRecords = retainChannel([current, ...remaining.filter((item) => item.channel === identity.channel)]);
      const trimmed = [...channelRecords, ...remaining.filter((item) => item.channel !== identity.channel)]
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
      while (trimmed.length > 1 && bytes(trimmed) > MAX_STORE_BYTES) trimmed.pop();
      // A prolonged stream can still exceed the storage quota on its own.
      // Group evidence is the largest part of a checkpoint and can be pruned
      // without dropping its recorded ER or viewer events.
      while (trimmed[0].checkpoint.groups.length && bytes(trimmed) > MAX_STORE_BYTES) {
        trimmed[0].checkpoint.groups.shift();
      }
      await this.write(trimmed);
      return { ...historySnapshot(trimmed, identity, settings), clearedAt: this.clearedAt };
    });
  }

  clear() {
    return this.transaction(async () => {
      this.clearedAt = Date.now();
      await this.write([]);
      return this.clearedAt;
    });
  }
}
