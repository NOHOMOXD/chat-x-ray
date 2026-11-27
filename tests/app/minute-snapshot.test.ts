import { describe, expect, it } from 'vitest';
import { buildMinuteSnapshot, countObservedMessages } from '../../src/app/minute-snapshot.ts';

const stats = { topAuthorMessages: 2, audienceMessages: 8, messagesPerMinute: 9, minuteUsers: 4 };

describe('observed minute', () => {
  it('distinguishes unobserved time from a zero message count', () => {
    expect(countObservedMessages([], null, 100, 200)).toBeNull();
    expect(countObservedMessages([], 101, 100, 200)).toBeNull();
    expect(countObservedMessages([], 100, 100, 200)).toBe(0);
    expect(countObservedMessages([{ ts: 100 }, { ts: 150 }, { ts: 200 }], 100, 100, 200)).toBe(2);
  });

  it('requires a full minute and fresh official viewer samples', () => {
    const samples = [{ ts: 40000, value: 1000 }, { ts: 100000, value: 1100 }];
    expect(buildMinuteSnapshot(100000, 50000, samples, stats)).toBeNull();
    expect(buildMinuteSnapshot(100000, 0, samples, stats)).toMatchObject({ from: 1000, to: 1100 });
    expect(buildMinuteSnapshot(107000, 0, samples, stats)).toMatchObject({ from: null, to: 1100 });
  });
});
