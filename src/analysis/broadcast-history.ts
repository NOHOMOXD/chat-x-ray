import type { BroadcastRecord } from './broadcast-history-model.ts';
import type { BroadcastIdentity, BroadcastProfileSettings } from './broadcast-profile.ts';
import type { HistoryUpdate } from './broadcast-history-clear.ts';
import type { TimedSample } from './broadcast-checkpoint.ts';
import type { SettingsStorageArea } from '../platform/browser-api.ts';
import { afterClear } from './broadcast-history-clear.ts';
import { broadcastProfile, sameBroadcast, startedAt } from './broadcast-profile.ts';
import { historySnapshot, retainChannel } from './broadcast-history-model.ts';
import { trimHistoryToSize } from './trim-history.ts';
import { callStorage, getStorageArea } from '../platform/browser-api.ts';
import { checkpointMerge, mergeSamples, readCheckpoint } from './broadcast-checkpoint.ts';

export const BROADCAST_HISTORY_KEY = 'tcx:broadcastHistory:v1';
export const HISTORY_CLEAR_KEY = 'tcx:broadcastHistory:clearedAt';
const MAX_STORE_BYTES = 4 * 1024 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface StoredBroadcast extends BroadcastIdentity {
  profiles: Record<string, TimedSample[]>;
  checkpoint: Record<string, unknown>;
  updatedAt?: number;
}

function readStoredBroadcast(value: unknown): StoredBroadcast | null {
  if (!isObject(value) || typeof value.channel !== 'string') return null;
  const id = typeof value.id === 'string' && value.id ? value.id : null;
  const startedAt = typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) ? value.startedAt : null;
  if (!id && startedAt === null) return null;
  const profiles: Record<string, TimedSample[]> = {};
  if (isObject(value.profiles)) {
    for (const [key, samples] of Object.entries(value.profiles)) {
      if (Array.isArray(samples)) profiles[key] = samples.filter((sample): sample is TimedSample =>
        isObject(sample) && typeof sample.ts === 'number' && Number.isFinite(sample.ts) &&
        typeof sample.er === 'number' && Number.isFinite(sample.er) && sample.er >= 0);
    }
  }
  return { channel: value.channel, id, startedAt, profiles,
    checkpoint: isObject(value.checkpoint) ? value.checkpoint : {},
    ...(typeof value.firstObservedAt === 'number' && Number.isFinite(value.firstObservedAt) ? { firstObservedAt: value.firstObservedAt } : {}),
    ...(typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? { updatedAt: value.updatedAt } : {}) };
}

function validIdentity(identity: BroadcastIdentity | null | undefined) {
  return identity?.channel && (identity.id || Number.isFinite(identity.startedAt));
}

interface HistoryLocks {
  request<T>(name: string, operation: () => Promise<T>): Promise<T>;
}

export class BroadcastHistory {
  private readonly storage: SettingsStorageArea | null;
  private readonly locks: HistoryLocks | null | undefined;
  private pending: Promise<unknown> = Promise.resolve();
  private memory: BroadcastRecord[] = [];
  private clearedAt = 0;

  constructor({ storage = getStorageArea(), locks = globalThis.navigator?.locks }: {
    storage?: SettingsStorageArea | null; locks?: HistoryLocks | null;
  } = {}) {
    this.storage = storage;
    this.locks = locks;
  }

  async read() {
    if (!this.storage) return this.memory;
    if (!this.storage.get) throw new Error('History storage cannot be read');
    const result = await callStorage(this.storage.get.bind(this.storage), [BROADCAST_HISTORY_KEY, HISTORY_CLEAR_KEY]);
    if (!isObject(result)) throw new Error('Invalid history storage response');
    const clearedAt = result[HISTORY_CLEAR_KEY];
    this.clearedAt = typeof clearedAt === 'number' && Number.isFinite(clearedAt) ? clearedAt : 0;
    const records = result[BROADCAST_HISTORY_KEY];
    if (records === undefined) return [];
    if (!Array.isArray(records)) throw new Error('Invalid broadcast history');
    return records.map(readStoredBroadcast).filter((record): record is StoredBroadcast => record !== null).map(record => ({
      ...record,
      checkpoint: checkpointMerge(readCheckpoint(record.checkpoint)),
      updatedAt: record.updatedAt ?? 0,
    }));
  }

  async write(records: BroadcastRecord[]) {
    if (!this.storage) {
      this.memory = records;
      return;
    }
    if (!this.storage.set) throw new Error('History storage cannot be written');
    const set = this.storage.set.bind(this.storage);
    await callStorage((items, done) => set(items, () => done(undefined)),
      { [BROADCAST_HISTORY_KEY]: records, [HISTORY_CLEAR_KEY]: this.clearedAt });
  }

  transaction<T>(operation: () => Promise<T>): Promise<T> {
    // All content scripts for Twitch share the Web Locks origin; the actual
    // data belongs to extension storage, never to Twitch storage.
    if (this.storage && this.locks?.request) {
      return this.locks.request(BROADCAST_HISTORY_KEY, operation);
    }
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  async load(identity: BroadcastIdentity, settings: BroadcastProfileSettings) {
    if (!validIdentity(identity)) return { checkpoint: null, baseline: null, history: [] };
    return { ...historySnapshot(await this.read(), identity, settings), clearedAt: this.clearedAt };
  }

  async save(identity: BroadcastIdentity, settings: BroadcastProfileSettings, update: HistoryUpdate) {
    if (!validIdentity(identity)) return this.load(identity, settings);
    return this.transaction(async () => {
      const records = await this.read();
      const matches = records.filter((item) => sameBroadcast(item, identity));
      const profiles: Record<string, TimedSample[]> = {};
      let checkpoint = checkpointMerge();
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
      trimHistoryToSize(trimmed, MAX_STORE_BYTES);
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
