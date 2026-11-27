// Keys and document leases live in extension storage. The sender's tab ID is
// supplied by the browser, never by a Twitch page or the content script.
import { RESUME_GAP_MS } from '../analysis/live-state.ts';
import { callStorage } from './browser-api.ts';

const PREFIX = 'tcx:reload:v2:';
const MAX_SNAPSHOT_AGE_MS = 300000;
const CLEANUP_INTERVAL_MS = 300000;

interface TabSnapshot {
  channel: string;
  savedAt: number;
  identity?: unknown;
  [field: string]: unknown;
}

interface CheckpointEntry {
  lease?: string;
  snapshot?: TabSnapshot | null;
}

function asEntries(value: unknown): Record<string, CheckpointEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries: Record<string, CheckpointEntry> = {};
  for (const [key, stored] of Object.entries(value)) {
    const entry: CheckpointEntry = {};
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      if ('lease' in stored && typeof stored.lease === 'string') entry.lease = stored.lease;
      if ('snapshot' in stored) {
        if (stored.snapshot === null) entry.snapshot = null;
        else if (isTabSnapshot(stored.snapshot)) entry.snapshot = stored.snapshot;
      }
    }
    entries[key] = entry;
  }
  return entries;
}

function isTabSnapshot(value: unknown): value is TabSnapshot {
  return Boolean(value && typeof value === 'object' &&
    'channel' in value && typeof value.channel === 'string' &&
    'savedAt' in value && typeof value.savedAt === 'number' && Number.isFinite(value.savedAt));
}


export class TabCheckpoints {
  private pending: Promise<unknown> = Promise.resolve();
  private lastCleanup: number | null = null;

  constructor(private readonly storage: chrome.storage.StorageArea, private readonly promiseAPI: boolean) {}

  call(method: 'get' | 'set' | 'remove', argument: unknown): Promise<unknown> {
    const fn = this.storage[method] as unknown as (argument: unknown, callback?: (value: unknown) => void) => unknown;
    return this.promiseAPI ? Promise.resolve(fn.call(this.storage, argument))
      : callStorage(fn.bind(this.storage), argument);
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => {});
    return next;
  }

  private async removeExpired(now: number): Promise<void> {
    const entries = asEntries(await this.call('get', null));
    const expired = Object.keys(entries).filter(name => {
      const snapshot = entries[name]?.snapshot;
      return name.startsWith(PREFIX) && snapshot && now - snapshot.savedAt > MAX_SNAPSHOT_AGE_MS;
    });
    if (expired.length) await this.call('remove', expired);
    this.lastCleanup = now;
  }

  /** Re-scan storage on background startup; later scans are rate-limited. */
  pruneExpired() {
    return this.run(() => this.removeExpired(Date.now()));
  }

  open(tabId: number, lease: string, reload: boolean, channel: string) {
    return this.run(async () => {
      const key = PREFIX + tabId + ':' + (channel || '');
      const closedKey = PREFIX + 'closed:' + channel;
      const now = Date.now();
      if (this.lastCleanup === null || now < this.lastCleanup || now - this.lastCleanup >= CLEANUP_INTERVAL_MS) {
        await this.removeExpired(now);
      }
      const entries = asEntries(await this.call('get', [key, closedKey]));
      const closed = entries[closedKey]?.snapshot;
      let previous = reload ? entries[key]?.snapshot : null;
      if (reload && closed?.identity && Date.now() - closed.savedAt <= RESUME_GAP_MS &&
          closed.savedAt > (previous?.savedAt ?? 0)) previous = { ...closed, requireIdentity: true };
      await this.call('set', { [key]: { lease, snapshot: previous ?? null } });
      return previous;
    });
  }

  save(tabId: number, lease: string, snapshot: unknown) {
    return this.run(async () => {
      if (!isTabSnapshot(snapshot)) return false;
      const key = PREFIX + tabId + ':' + (snapshot.channel || '');
      const entry = asEntries(await this.call('get', key))[key];
      if (entry?.lease !== lease || Number(entry.snapshot?.savedAt) > snapshot.savedAt) return false;
      await this.call('set', { [key]: { lease, snapshot } });
      return true;
    });
  }

  close(tabId: number) {
    return this.run(async () => {
      const entries = asEntries(await this.call('get', null));
      const keys = Object.keys(entries).filter(key => key.startsWith(PREFIX + tabId + ':'));
      for (const key of keys) {
        const snapshot = entries[key]?.snapshot;
        if (!snapshot?.identity || Date.now() - snapshot.savedAt > RESUME_GAP_MS) continue;
        const closed = PREFIX + 'closed:' + snapshot.channel;
        if (snapshot.savedAt > (entries[closed]?.snapshot?.savedAt ?? 0)) {
          await this.call('set', { [closed]: { snapshot } });
        }
      }
      if (keys.length) await this.call('remove', keys);
    });
  }

  clear() {
    return this.run(async () => {
      const keys = Object.keys(asEntries(await this.call('get', null))).filter(key => key.startsWith(PREFIX));
      if (keys.length) await this.call('remove', keys);
    });
  }
}
