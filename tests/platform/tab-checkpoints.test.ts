import { expect, it, vi } from 'vitest';
import { TabCheckpoints } from '../../src/platform/tab-checkpoints.ts';

function fakeStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: async (key: string | string[] | null) => key === null ? { ...data } :
      Object.fromEntries((Array.isArray(key) ? key : [key]).filter(item => item in data).map(item => [item, data[item]])),
    set: async (values: Record<string, unknown>) => Object.assign(data, values),
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

it('replaces a future snapshot while retaining lease protection', async () => {
  const key = 'tcx:reload:v2:1:example';
  const now = Date.now();
  const storage = fakeStorage({ [key]: { lease: 'current', snapshot: { channel: 'example', savedAt: now + 60000 } } });
  const tabs = new TabCheckpoints(storage as unknown as chrome.storage.StorageArea, true);
  expect(await tabs.save(1, 'old', { channel: 'example', savedAt: now })).toBe(false);
  expect(await tabs.save(1, 'current', { channel: 'example', savedAt: now })).toBe(true);
  expect(await tabs.open(1, 'next', true, 'example')).toMatchObject({ savedAt: now });
  expect(await tabs.save(1, 'current', { channel: 'example', savedAt: now })).toBe(false);
});

it('does not let an older document lease overwrite the latest snapshot', async () => {
  const tabs = new TabCheckpoints(fakeStorage() as unknown as chrome.storage.StorageArea, true);
  const snapshot = { channel: 'example', savedAt: Date.now(), identity: { id: '1' } };
  await tabs.open(1, 'first', true, 'example');
  expect(await tabs.save(1, 'first', snapshot)).toBe(true);
  expect(await tabs.open(1, 'second', true, 'example')).toEqual(snapshot);
  expect(await tabs.save(1, 'first', { ...snapshot, savedAt: snapshot.savedAt + 1 })).toBe(false);
  expect(await tabs.save(1, 'second', snapshot)).toBe(true);
});

it('ignores malformed snapshots and can clear malformed stored entries', async () => {
  const key = 'tcx:reload:v2:1:example';
  const storage = fakeStorage({ [key]: 'invalid' });
  const tabs = new TabCheckpoints(storage as unknown as chrome.storage.StorageArea, true);
  expect(await tabs.open(1, 'lease', true, 'example')).toBeUndefined();
  expect(await tabs.save(1, 'lease', { channel: 'example', savedAt: 'bad' })).toBe(false);
  await tabs.clear();
  expect(await storage.get(null)).toEqual({});
});


it('reads only the current and closed keys after cleanup and rescans on background restart', async () => {
  const now = Date.now();
  const oldKey = 'tcx:reload:v2:7:old';
  const currentKey = 'tcx:reload:v2:1:example';
  const closedKey = 'tcx:reload:v2:closed:example';
  const historyKey = 'tcx:broadcastHistory:v1';
  const storage = fakeStorage({
    [historyKey]: [{ payload: 'keep history' }],
    [oldKey]: { snapshot: { channel: 'old', savedAt: now - 300001 } },
    [currentKey]: { snapshot: { channel: 'example', savedAt: now } },
  });
  const get = vi.spyOn(storage, 'get');
  const tabs = new TabCheckpoints(storage as unknown as chrome.storage.StorageArea, true);
  await tabs.pruneExpired();
  get.mockClear();
  expect(await tabs.open(1, 'lease', true, 'example')).toMatchObject({ channel: 'example', savedAt: now });
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith([currentKey, closedKey]);
  expect((await storage.get(null))[historyKey]).toEqual([{ payload: 'keep history' }]);
  await storage.set({ [oldKey]: { snapshot: { channel: 'old', savedAt: now - 300001 } } });
  const restarted = new TabCheckpoints(storage as unknown as chrome.storage.StorageArea, true);
  await restarted.pruneExpired();
  expect((await storage.get(null))[oldKey]).toBeUndefined();
  expect((await storage.get(null))[historyKey]).toEqual([{ payload: 'keep history' }]);
});
