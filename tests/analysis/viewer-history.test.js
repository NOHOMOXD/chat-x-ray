import { describe, expect, it } from 'vitest';

import {
  ViewerHistory,
  erPercent,
  median,
} from '../../src/analysis/viewer-history.js';

const MINUTE = 60 * 1000;

describe('erPercent', () => {
  it('computes clean chatters as a percentage of viewers', () => {
    expect(erPercent(50, 1000)).toBe(5);
    expect(erPercent(170, 3542)).toBe(4.8);
  });

  it('returns null when the rate is undefined', () => {
    expect(erPercent(10, 0)).toBe(null);
    expect(erPercent(-1, 100)).toBe(null);
    expect(erPercent(Number.NaN, 100)).toBe(null);
  });
});

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([1, 2, 3])).toBe(2);
    // Even lengths are rounded to an integer, which is what viewer counts need.
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBe(null);
    expect(median(null)).toBe(null);
  });
});

describe('ViewerHistory', () => {
  it('ignores samples that arrive too quickly', () => {
    const history = new ViewerHistory({ minSampleIntervalMs: 5000 });
    const t0 = 1_000_000;
    history.record(1000, t0);
    history.record(2000, t0 + 1000);
    expect(history.samples).toHaveLength(1);
  });

  it('records samples spaced beyond the interval', () => {
    const history = new ViewerHistory({ minSampleIntervalMs: 5000 });
    const t0 = 1_000_000;
    history.record(1000, t0);
    history.record(1200, t0 + 10_000);
    expect(history.samples).toHaveLength(2);
  });

  it('keeps a bounded peak window', () => {
    const history = new ViewerHistory({ maxSamples: 5, minSampleIntervalMs: 0 });
    for (let i = 0; i < 20; i += 1) {
      history.record(1000 + i, 1_000_000 + i * 10_000);
    }
    expect(history.samples.length).toBeLessThanOrEqual(5);
  });

  it('resets all state', () => {
    const history = new ViewerHistory({ minSampleIntervalMs: 0 });
    history.record(1000, 1_000_000);
    history.reset();
    expect(history.samples).toHaveLength(0);
  });

  it('reports a stable median instead of the jumping live number', () => {
    const history = new ViewerHistory({ minSampleIntervalMs: 0, warmupMs: 0 });
    const t0 = 1_000_000;
    [50000, 50000, 50000, 40000].forEach((value, i) => {
      history.record(value, t0 + i * MINUTE);
    });
    expect(history.getStats(t0 + 4 * MINUTE).median).toBe(50000);
  });
});
