import { webcrypto } from 'node:crypto';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { describeGroups } from '../../src/core/id-group-diagnostics.js';
import {
  analyzeGroupRecurrence, buildGroupObservation, applyGroupHistoryBonus,
} from '../../src/analysis/group-history.js';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
afterAll(() => vi.unstubAllGlobals());

const phrase = 'repeated unusual example';
const first = [10, 20, 30, 40, 50, 70];
const record = (id, text, botScore = 25) => ({
  id: String(id), numericUserId: id, userKey: 'id:' + id, text, unbadged: true, botScore, triggers: [],
});
const outsiders = Array.from({ length: 40 }, (_, index) => record(100 + index, 'different text'));

async function observation(ids = first, speakers = ids.slice(0, 2), outside = outsiders) {
  const records = [...ids.map((id) => record(id, speakers.includes(id) ? phrase : 'hello')), ...outside];
  const groups = describeGroups([{ from: ids[0], to: ids.at(-1), memberIds: ids }], records, true);
  return buildGroupObservation({ groups }, { ts: 123 });
}

it('stores hashed phrases, counts identical broadcast IDs once and tracks precise co-speakers', async () => {
  const current = await observation();
  const same = await observation();
  const otherBandMembers = await observation([11, 21, 31, 41, 51, 61]);
  const oneReturningAuthor = await observation([10, 22, 32, 42, 52, 72]);
  const recurrence = analyzeGroupRecurrence(current, [
    { id: 'a', groupObservations: [same, same] },
    { id: 'a', groupObservations: [same] },
    { id: 'b', groupObservations: [otherBandMembers] },
    { id: 'c', groupObservations: [oneReturningAuthor] },
    { id: 'quiet', groupObservations: [{ ts: 0, groups: [] }] },
  ]);
  expect(JSON.stringify(current)).not.toContain(phrase);
  expect(current.groups[0].phrases.some((item) => /^[\da-f]{32}$/.test(item.fingerprint))).toBe(true);
  expect(recurrence).toMatchObject({
    observedBroadcasts: 4,
    groups: [{ bandBroadcasts: 3, sharedMemberBroadcasts: 1, coordinatedBroadcasts: 1 }],
    authors: {
      10: { groupBroadcasts: 2, coordinatedBroadcasts: 1 },
      20: { groupBroadcasts: 1, coordinatedBroadcasts: 1 },
      30: { groupBroadcasts: 1, coordinatedBroadcasts: 0 },
    },
  });
  const messages = first.map((id) => record(id, phrase));
  messages[0].botScore = 95;
  messages[0].triggers.push({ key: 'self-repeat' });
  for (const message of messages) {
    applyGroupHistoryBonus(message, recurrence);
    applyGroupHistoryBonus(message, recurrence);
  }
  expect(messages.map(({ botScore }) => botScore)).toEqual([100, 25, 25, 25, 25, 25]);
  expect(messages[0].triggers).toHaveLength(2);
});

it('rejects a channel-wide phrase and requires the same speakers across broadcasts', async () => {
  const current = await observation();
  const common = await observation(first, [10, 20], outsiders.map((item) => ({ ...item, text: phrase })));
  const otherSpeakers = await observation(first, [20, 30]);
  const result = analyzeGroupRecurrence(current, [{ id: 'a', groupObservations: [common, otherSpeakers] }]);
  expect(result.groups[0]).toMatchObject({ sharedMemberBroadcasts: 1, coordinatedBroadcasts: 0 });
});

it('uses at most 20 prior broadcasts and leaves exempt authors out of the experiment', async () => {
  const current = await observation();
  const prior = Array.from({ length: 21 }, (_, index) => ({ id: String(index), groupObservations: [current] }));
  const recurrence = analyzeGroupRecurrence(current, prior);
  expect(recurrence.observedBroadcasts).toBe(20);
  expect(recurrence.authors[10]).toEqual({ groupBroadcasts: 20, coordinatedBroadcasts: 20 });
  const messages = [
    { ...record(10, phrase), roleExempt: true },
    { ...record(20, phrase), unbadged: false },
  ];
  for (const message of messages) applyGroupHistoryBonus(message, recurrence);
  expect(messages.map(({ botScore }) => botScore)).toEqual([25, 25]);
});
