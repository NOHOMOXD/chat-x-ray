import { expect, it } from 'vitest';
import { trimHistoryToSize } from '../../src/analysis/trim-history.ts';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const record = (id: string, groups: Array<{ text: string }> = []) => ({ id, checkpoint: { groups } });

it('removes oldest broadcasts while preserving the newest record', () => {
  const data = [record('new'), record('middle'), record('old')];
  const limit = bytes(data.slice(0, 2));
  expect(trimHistoryToSize(data, limit).map(item => item.id)).toEqual(['new', 'middle']);
});

it('removes oldest group windows only when a single broadcast exceeds the limit', () => {
  const groups = [{ text: 'old' }, { text: 'middle' }, { text: 'new' }];
  const data = [record('new', groups)];
  const limit = bytes([record('new', groups.slice(1))]);
  trimHistoryToSize(data, limit);
  expect(groups).toEqual([{ text: 'middle' }, { text: 'new' }]);
  expect(bytes(data)).toBeLessThanOrEqual(limit);
});

it('keeps one broadcast even when deleting every group cannot meet the limit', () => {
  const data = [record('x'.repeat(100), [{ text: 'old' }]), record('old')];
  trimHistoryToSize(data, 1);
  expect(data).toHaveLength(1);
  expect(data[0]?.checkpoint.groups).toEqual([]);
});

it('counts UTF-8 bytes and leaves an exactly fitting history intact', () => {
  const data = [record('канал🙂', [{ text: 'чат' }])];
  const limit = bytes(data);
  expect(trimHistoryToSize(data, limit)).toEqual([record('канал🙂', [{ text: 'чат' }])]);
});
