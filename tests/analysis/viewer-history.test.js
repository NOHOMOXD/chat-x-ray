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

describe('viewer anomalies', () => {
  const start = 1_000_000;
  const scenario = (recoveryDelay) => {
    const history = new ViewerHistory();
    history.record(50_000, start);
    history.record(40_000, start + 30_000);
    for (let age = 60_000; age < recoveryDelay; age += 30_000) {
      history.record(40_000, start + 30_000 + age);
    }
    const end = start + 30_000 + recoveryDelay;
    history.record(50_000, end);
    return history.getStats(end);
  };

  it('accepts recovery at five minutes and rejects recovery after the deadline', () => {
    expect(scenario(300_000).totalChurnEvents).toBe(1);
    expect(scenario(303_000).totalChurnEvents).toBe(0);
  });

  it('does not recover a pending drop across missing samples', () => {
    const history = new ViewerHistory();
    history.record(50_000, start);
    history.record(40_000, start + 30_000);
    history.record(50_000, start + 120_000);
    expect(history.getStats(start + 120_000).totalChurnEvents).toBe(0);
  });

  it('keeps a candidate and raid context, counts its continuation once, and retains the session total', () => {
    const history = new ViewerHistory();
    const raid = { id: 'raid', ts: start + 5_000, viewers: 2 };
    expect(history.recordRaid(raid)).toBe(true);
    expect(history.recordRaid(raid)).toBe(false);
    history.record(20_000, start);
    const { anomaly } = history.record(23_000, start + 30_000, {
      countMessages: (from) => from < start ? 20 : 5,
    });
    expect(anomaly).toMatchObject({ kind: 'surge', delta: 3000, rateRatio: 1, raid });
    history.record(30_000, start + 40_000);
    expect(history.getStats(start + 16 * MINUTE)).toMatchObject({
      totalSurges: 1, averageSurge: 3000, lastAnomaly: anomaly,
    });
  });

  it('preserves cumulative rollbacks and removes old events from the current verdict', () => {
    const history = new ViewerHistory();
    for (const [offset, value] of [[0, 50_000], [30_000, 40_000], [60_000, 50_000]]) {
      history.record(value, start + offset);
    }
    expect(history.getStats(start + 17 * MINUTE)).toMatchObject({
      totalSurges: 0, totalChurnEvents: 1, churnRecent: 0, averageDrop: 10_000,
      lastAnomaly: { kind: 'churn', from: 50_000, to: 40_000 },
    });
  });
});

describe('viewer outflows', () => {
  const start = 1795082799300;

  it('retains the shadowkekw drop and its deepest sample after the deadline', () => {
    const history = new ViewerHistory();
    let recorded;
    const samples = [
      [0, 44_493], [19_643, 41_262], [36_000, 40_652], [66_000, 36_801],
      [120_000, 36_452], [170_000, 36_374], [220_000, 36_365],
      [268_647, 36_110], [310_000, 36_152], [340_000, 36_268],
    ];
    for (const [offset, value] of samples) {
      recorded = history.record(value, start + offset)?.outflow ?? recorded;
    }
    const stats = history.getStats(start + 340_000);
    expect(stats).toMatchObject({
      totalOutflows: 1, totalSurges: 0, totalChurnEvents: 0, pendingDrop: null,
      lastOutflow: { from: 44_493, to: 36_110, delta: -8383, status: 'unrecovered' },
    });
    expect(recorded).toEqual(stats.lastOutflow);
  });

  it('ignores a single low sample and closes a confirmed episode on interruption', () => {
    const history = new ViewerHistory();
    history.record(40_000, start);
    history.record(30_000, start + 3000);
    history.record(40_000, start + 6000);
    expect(history.getStats(start + 6000).totalOutflows).toBe(0);
    history.record(30_000, start + 9000);
    history.record(30_000, start + 24_000);
    history.record(20_000, start + 120_000);
    expect(history.getStats(start + 120_000)).toMatchObject({
      totalOutflows: 1, totalChurnEvents: 0, pendingDrop: null,
      lastOutflow: { status: 'interrupted', to: 30_000 },
    });
  });

  it('attaches the IShowSpeed recovery to the same event', () => {
    const history = new ViewerHistory();
    const samples = [[0, 37312], [3000, 34149], [19000, 34149], [59000, 32233],
      [110000, 32800], [160000, 33700], [210000, 35000], [260000, 36568]];
    for (const [offset, value] of samples) history.record(value, start + offset);
    expect(history.getStats(start + 260000)).toMatchObject({
      totalOutflows: 1, totalChurnEvents: 1, totalSurges: 0,
      lastOutflow: { delta: -5079, status: 'recovered', recoveredAt: start + 260000 },
    });
  });
});
