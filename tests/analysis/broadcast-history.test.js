import { describe, expect, it } from 'vitest';
import { BroadcastHistory, broadcastRelation, mergeIntervals } from '../../src/analysis/broadcast-history.js';

const settings = { suspiciousThreshold: 30, accountAgeLookup: false };
const identity = (id) => ({ channel: 'example', id: String(id), startedAt: id * 6000000 });

function sharedPersistence() {
  let data = {};
  let queue = Promise.resolve();
  return {
    storage: {
      get: async () => structuredClone(data),
      set: async (value) => { data = { ...data, ...structuredClone(value) }; },
    },
    locks: {
      request(_key, operation) {
        const result = queue.then(operation);
        queue = result.catch(() => {});
        return result;
      },
    },
  };
}

describe('broadcast history', () => {
  it('deduplicates overlapping observers, events, and minute samples across concurrent writes', async () => {
    const options = sharedPersistence();
    const a = new BroadcastHistory(options);
    const b = new BroadcastHistory(options);
    await Promise.all([
      a.save(identity(1), settings, {
        intervals: { chat: [[1, 9]], viewer: [[1, 3]] },
        events: [{ kind: 'viewer-outflow', ts: 123, from: 10000, to: 8000, delta: -2000 }],
        samples: [{ ts: 60000, er: 3.76 }],
      }),
      b.save(identity(1), settings, {
        intervals: { chat: [[7, 15]], viewer: [[7, 10]] },
        events: [{ kind: 'viewer-outflow', ts: 125, from: 10000, to: 7000, delta: -3000,
          recoveredAt: 200, closedAt: 200, status: 'recovered' }],
        samples: [{ ts: 60500, er: 4 }, { ts: 120000, er: 4.24 }],
      }),
    ]);
    const restarted = new BroadcastHistory(options);
    const { checkpoint, baseline } = await restarted.load(identity(1), settings);
    expect(baseline).toBeNull();
    expect(checkpoint.samples.map(({ er }) => er)).toEqual([3.76, 4.24]);
    expect(checkpoint.intervals).toEqual({ chat: [[1, 15]], viewer: [[1, 3], [7, 10]] });
    expect(checkpoint.events).toEqual([expect.objectContaining({ status: 'recovered', ts: 123, delta: -3000 })]);
    expect((await restarted.load(identity(2), settings)).baseline).toMatchObject({ er: 4, sessions: 1 });
  });

  it('discards queued pre-clear evidence from a second open tab', async () => {
    const persistence = sharedPersistence();
    const first = new BroadcastHistory(persistence);
    const second = new BroadcastHistory(persistence);
    const target = identity(5);
    const old = {
      intervals: { chat: [[1, 100]], viewer: [[5, 100]] },
      samples: [{ ts: 100, er: 3 }],
      groups: [{ ts: 100, groups: [] }],
      events: [{ kind: 'chat-wave', ts: 100, bucketStart: 0 }],
      lastViewerModel: { sampledAt: 100 },
    };
    await second.save(target, settings, old);
    await first.clear();
    const cutoff = first.clearedAt;
    const staleReplay = await second.save(target, settings, old);
    expect(staleReplay.clearedAt).toBe(cutoff);
    expect(staleReplay.checkpoint).toMatchObject({
      intervals: { chat: [], viewer: [] },
      samples: [], events: [], groups: [], lastViewerModel: null,
    });

    const fresh = cutoff + 600000;
    const resumed = await second.save(target, settings, {
      intervals: { chat: [[1, fresh]], viewer: [[1, fresh]] },
      samples: [{ ts: cutoff + 1, er: 1 }, { ts: fresh, er: 2 }],
      events: [{ kind: 'surge', ts: fresh }],
    });
    expect(resumed.checkpoint).toMatchObject({
      intervals: { chat: [[cutoff, fresh]], viewer: [[cutoff, fresh]] },
      samples: [{ ts: fresh, er: 2 }],
      events: [{ kind: 'surge', ts: fresh }],
    });
  });

  it('promotes an absolute start timestamp to the explicit ID', async () => {
    const store = new BroadcastHistory({ storage: null });
    const fallback = { ...identity(1), id: null };
    await store.save(fallback, settings, { samples: [{ ts: 60000, er: 3 }] });
    const promoted = await store.save(identity(1), settings, {});
    expect(promoted.baseline).toBeNull();
    expect(promoted.checkpoint.samples).toEqual([{ ts: 60000, er: 3 }]);
    const next = await store.load(identity(2), settings);
    expect(next.history.map(({ id }) => id)).toEqual(['1']);
  });

  it('keeps the first observed order when reopening a broadcast with only its ID', async () => {
    const store = new BroadcastHistory({ storage: null });
    const first = { channel: 'example', id: '1', firstObservedAt: 1000 };
    const second = { channel: 'example', id: '2', firstObservedAt: 2000 };
    await store.save(first, settings, { samples: [{ ts: 80000, er: 3 }] });
    await store.save(second, settings, { samples: [{ ts: 90000, er: 9 }] });
    const reopened = await store.save({ ...first, firstObservedAt: 100000 }, settings, {});
    expect(reopened.baseline).toBeNull();
    expect((await store.load(second, settings)).baseline).toMatchObject({ sessions: 1, er: 3 });
  });

  it('excludes the current broadcast, future broadcasts, and incompatible scorer settings', async () => {
    const store = new BroadcastHistory({ storage: null });
    for (let id = 1; id <= 7; id += 1) {
      await store.save(identity(id), settings, { samples: [{ ts: 60000, er: id }] });
    }
    await store.save(identity(5), { ...settings, accountAgeLookup: true }, {
      samples: [{ ts: 60000, er: 99 }],
    });
    const { baseline } = await store.load(identity(6), settings);
    expect(baseline).toEqual({ sessions: 5, er: 3, lastEr: 5, low: 2, high: 4 });
    expect(broadcastRelation(1.5, baseline)).toBe('low');
    expect(broadcastRelation(2, baseline)).toBe('typical');
    expect(broadcastRelation(4.5, baseline)).toBe('high');
    expect((await store.load(identity(6), { ...settings, suspiciousThreshold: 25 })).baseline).toBeNull();
    await store.clear();
    expect((await store.load(identity(6), settings)).baseline).toBeNull();
  });
});

it('merges only genuinely observed duration', () => {
  expect(mergeIntervals([[6, 9], [1, 3], [2, 4], [0, 0], [20, 12]])).toEqual([[1, 4], [6, 9]]);
});

it('retains the last full measurement during partial coverage after reopening', async () => {
  const store = new BroadcastHistory({ storage: null });
  const measured = { sampledAt: 600001, engagement: { measurable: true }, historyProfile: 'test' };
  await store.save(identity(1), settings, { lastViewerModel: measured });
  const reopened = await store.save(identity(1), settings, {
    lastViewerModel: { sampledAt: 600002, engagement: { measurable: false }, historyProfile: 'test' },
  });
  expect(reopened.checkpoint.lastViewerModel).toEqual(measured);
});
