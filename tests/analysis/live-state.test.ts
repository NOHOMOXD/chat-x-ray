import { expect, it } from 'vitest';
import { ChatSession } from '../../src/core/chat-session.ts';
import {
  createLiveSnapshot, restoreLiveSnapshot, observedWindow, savedRange, sameLiveBroadcast, resumedWindow,
} from '../../src/analysis/live-state.ts';

const identity = { channel: 'example', id: '123', startedAt: 5000 };
const model = { range: { low: 800, high: 1200 }, sampledAt: 9000, historyProfile: 'profile' };
const base = { channel: 'example', identity, model, now: 10000,
  chat: [[1000, 5000]], viewer: [[2000, 9000], [8000, 9000]] };

it('keeps private counters and event summaries without chat text or diagnostics', () => {
  const row = { id: 'msg', ts: 9000, userKey: 'id:1', sequence: 1, botScore: 50,
    command: '!нож', text: 'sensitive chat', triggers: [{ key: 'self-repeat' }] };
  const snapshot = createLiveSnapshot({ ...base, model: { ...model, input: { private: true } },
    records: [row], events: [{ ts: 8000, kind: 'chat-wave', authors: 2, atTrigger: { sensitive: true } }] });
  if (!snapshot) throw new Error('Expected a snapshot');
  expect(JSON.stringify(snapshot)).not.toMatch(/private|sensitive/);
  expect(snapshot.viewer).toEqual([[2000, 9000]]);
  const saved = restoreLiveSnapshot(snapshot, 'example', identity, 20000);
  if (!saved) throw new Error('Expected a restored snapshot');
  expect(saved.model).toEqual(model);
  expect(observedWindow([], saved.rows, 20000, 50)).toMatchObject({
    activeUsers: 1, suspiciousUsers: 1, audienceMessages: 1, cleanUsers: 0,
  });
  expect(observedWindow([], saved.rows, 610001, 50).activeUsers).toBe(0);
});

it('accepts a short reload in one channel without identifying an unknown broadcast', () => {
  const saved = createLiveSnapshot({ ...base, identity: null });
  expect(restoreLiveSnapshot(saved, 'example', null, 310000)).not.toBeNull();
  expect(restoreLiveSnapshot(saved, 'example', null, 310001)).toBeNull();
  expect(restoreLiveSnapshot(saved, 'other', null, 10001)).toBeNull();
  expect(restoreLiveSnapshot(saved, 'example', { ...identity, startedAt: 11000 }, 11001)).toBeNull();
  expect(sameLiveBroadcast(null, null)).toBe(false);
  expect(sameLiveBroadcast(identity, { channel: 'example', startedAt: 5000 })).toBe(true);
  expect(sameLiveBroadcast(identity, { ...identity, id: '456' })).toBe(false);
  const known = createLiveSnapshot(base);
  if (!known) throw new Error('Expected a snapshot');
  expect(restoreLiveSnapshot(known, 'example', { ...identity, id: '456' }, 20000)).toBeNull();
  expect(restoreLiveSnapshot({ ...known, savedAt: 30000 }, 'example', null, 20000)).toBeNull();
});

it('preserves the original measurement time, even across a second reload', () => {
  expect(savedRange(model, 49000)).toEqual(model);
  expect(savedRange(savedRange(model, 49000), 69000)).toEqual(model);
  expect(savedRange(model, 3609000)).toEqual(model);
  expect(savedRange({ ...model, recentAge: 40 }, 49000)).toBeNull();
});

it('continues through two minutes away without counting the gap', () => {
  expect(resumedWindow([[1000, 121000], [241000, 242000]], 242000)).toEqual({ start: 1000, duration: 121000 });
  expect(resumedWindow([[1000, 121000], [241001, 242001]], 242001)).toEqual({ start: 241001, duration: 1000 });
});

it('counts live and restored rows with the same rolling-window rules', () => {
  const records = [
    { id: 'new', ts: 590000, receivedAt: 590000, sequence: 1, userKey: 'a', botScore: 50,
      triggers: [{ key: 'self-repeat' }], command: '!hello' },
    { id: 'old', ts: 1, receivedAt: 1, sequence: 2, userKey: 'b', botScore: 0, triggers: [] },
  ];
  const session = new ChatSession({ suspiciousThreshold: 50 });
  session.records = [...records];
  const live = session.getStats(610000);
  const restored = observedWindow([], records, 610000, 50);
  expect(restored).toEqual(live);
  expect(restored).toMatchObject({ activeUsers: 1, suspiciousUsers: 1, windowMessages: 1 });
});

it('ignores malformed rows in a saved snapshot', () => {
  const saved = createLiveSnapshot(base);
  if (!saved) throw new Error('Expected a snapshot');
  const restored = restoreLiveSnapshot({ ...saved, rows: { invalid: true } }, 'example', identity, 20000);
  if (!restored) throw new Error('Expected a restored snapshot');
  expect(restored.rows).toEqual([]);
  const malformed = restoreLiveSnapshot({ ...saved, rows: [['msg', 9000, 'id:1', {}, 0]] },
    'example', identity, 20000);
  expect(malformed?.rows).toEqual([]);
});

it('retains valid events and viewer samples when a snapshot contains damaged fields', () => {
  const saved = createLiveSnapshot(base);
  if (!saved) throw new Error('Expected a snapshot');
  const restored = restoreLiveSnapshot({ ...saved,
    events: [null, { kind: 'chat-wave', ts: 9000, authors: 2 }, { kind: 'bad', ts: 'bad' }],
    samples: [{ ts: 9000, value: 1000, clean: 5 }, { ts: 'bad', value: 1000 }],
    formula: 'bad', confirmed: null, bonuses: [],
  }, 'example', identity, 20000);
  if (!restored) throw new Error('Expected a restored snapshot');
  expect(restored.events).toEqual([{ kind: 'chat-wave', ts: 9000, authors: 2 }]);
  expect(restored.samples).toEqual([{ ts: 9000, value: 1000, clean: 5 }]);
  expect(restored.formula).toEqual([]);
  expect(restored.confirmed).toEqual({});
  expect(restored.bonuses).toEqual({});
});
