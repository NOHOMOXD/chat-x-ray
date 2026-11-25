import { expect, it } from 'vitest';
import { describeGroups, findIdGroups, recordsAt, summarizeMatches } from '../../src/core/id-group-diagnostics.js';

const now = 900000;
const user = (id, other = {}) => ({
  id: 'msg' + id, userKey: 'user' + id, numericUserId: id,
  ts: now, unbadged: true, text: 'A repeated phrase', ...other,
});

it('finds multiple groups, breaks ties by lower ID and deduplicates authors', () => {
  const first = [1, 2, 3, 4, 5, 50000];
  const second = [100001, 100002, 100003, 100004, 100005, 150000];
  const records = [...second, ...first, 50001, 50001].map((id) => user(id));
  records.push(user(50002, { ts: now - 600000 }), user(50003, { receivedAt: now + 1 }));
  expect(findIdGroups(recordsAt(records, now)).map(({ memberIds }) => memberIds))
    .toEqual([first, second]);
});

it('counts R9K sources and measures distinct authors using the same phrase', () => {
  const outside = user(100000);
  const inside = [1, 2, 3, 4, 5, 6].map((id) => user(id));
  const duplicate = (record, source) => ({ ...record, id: record.id + '-repeat',
    isR9KDuplicate: true, r9kMatchId: source });
  const subjects = [
    ...inside, duplicate(inside[0], inside[0].id), duplicate(inside[1], inside[0].id),
    duplicate(inside[2], outside.id), duplicate(inside[3], 'missing-id'),
  ];
  const context = [...subjects, outside];
  const groups = describeGroups(findIdGroups(context), context);
  expect(groups[0]).toMatchObject({
    authors: 6, r9k: { self: 1, member: 1, outside: 1, missing: 1 },
    phrases: [{ text: 'a repeated phrase', authors: 6, messages: 10, outsideAuthors: 1 }],
  });
  expect(summarizeMatches(subjects, context, new Set(inside.map(({ userKey }) => userKey))).r9k)
    .toEqual(groups[0].r9k);
});

it('replaces the cluster weight in the exported comparison and applies the same age rule', async () => {
  const { compareIdGroupScores } = await import('../../src/analysis/session-capture.js');
  const unbadged = { points: 20, key: 'profile' };
  const cluster = { points: 15, key: 'id-cluster' };
  const fresh = { points: 10, key: 'fresh-account' };
  const records = [1, 2, 3, 4, 5, 6].map((id) => user(id, { triggers: [unbadged] }));
  records[0].triggers.push(cluster);
  records.push(user(100000, { triggers: [unbadged, cluster, fresh], accountAgeSource: 'id' }));
  records.push(user(200000, {
    triggers: [unbadged], accountAgeSource: 'api', accountAgeDays: 89,
  }));
  for (const row of records) row.triggers.push({ key: 'mechanical-rhythm', points: 5 });
  const result = compareIdGroupScores(records, now, { suspiciousThreshold: 30 });
  expect(result.comparison.crossings).toEqual({
    both: ['user1', 'user200000'], currentOnly: ['user100000'],
    experimentalOnly: ['user2', 'user3', 'user4', 'user5', 'user6'],
    neither: [],
  });
});
