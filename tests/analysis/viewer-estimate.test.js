import { describe, expect, it } from 'vitest';

import {
  VIEWER_ESTIMATE_DEFAULTS,
  buildViewerModel,
  classifyViewerSignals,
  estimateViewerRange,
  getChatEngagement,
  getLoadingProgress,
  roundViewerBound,
  verdictLabel,
} from '../../src/analysis/viewer-estimate.js';

/** A comfortable 10-minute sample: 1000 clean of 1200 active chatters. */
function stats(overrides = {}) {
  return {
    activeUsers: 1200,
    cleanUsers: 1000,
    suspiciousUsers: 200,
    suspiciousPercent: 17,
    windowMessages: 5000,
    messagesPerMinute: 420,
    sessionMs: 10 * 60 * 1000,
    isBotWave: false,
    ...overrides,
  };
}

describe('roundViewerBound', () => {
  it('rounds to a readable step that grows with magnitude', () => {
    expect(roundViewerBound(6412)).toBe(6400);
    expect(roundViewerBound(12531)).toBe(12500);
    expect(roundViewerBound(123456)).toBe(123000);
    expect(roundViewerBound(7.4)).toBe(7);
    expect(roundViewerBound(0)).toBe(0);
  });
});

describe('estimateViewerRange', () => {
  it('extrapolates ~8-12.5 viewers per clean chatter', () => {
    const range = estimateViewerRange(56090, stats());
    expect(range.low).toBe(8000);
    expect(range.high).toBe(12500);
    expect(range.confidence).toBe('high');
  });

  it('refuses to estimate without a big enough sample', () => {
    expect(estimateViewerRange(50000, stats({ cleanUsers: 1 }))).toBe(null);
    expect(estimateViewerRange(50000, stats({ sessionMs: 60_000 }))).toBe(null);
    expect(estimateViewerRange(50000, stats({ windowMessages: 4 }))).toBe(null);
    expect(estimateViewerRange(0, stats())).toBe(null);
    expect(estimateViewerRange(Number.NaN, stats())).toBe(null);
  });

  it('never exceeds the official count', () => {
    const range = estimateViewerRange(1000, stats({ activeUsers: 900, cleanUsers: 900 }));
    expect(range.high).toBeLessThanOrEqual(1000);
    expect(range.low).toBeLessThanOrEqual(range.high);
  });

  it('scales a short observation toward the 10-minute reference', () => {
    const range = estimateViewerRange(
      50000,
      stats({ cleanUsers: 250, activeUsers: 300, sessionMs: 2.5 * 60 * 1000 })
    );
    expect(range.effectiveChatters).toBe(1000);
    expect(range.sessionScale).toBe(4);
  });

  it('widens the band and reports low confidence for a short sample', () => {
    const range = estimateViewerRange(
      50000,
      stats({ cleanUsers: 300, activeUsers: 400, sessionMs: 2 * 60 * 1000 })
    );
    expect(range.confidence).toBe('low');
  });
});

describe('getChatEngagement', () => {
  it('flags low engagement on a large stream', () => {
    const er = getChatEngagement(56090, stats({ cleanUsers: 300, activeUsers: 1100 }));
    expect(er.percent).toBeCloseTo(0.535, 2);
    expect(er.alert).toBe(true);
  });

  it('does not flag a healthy engagement rate', () => {
    const er = getChatEngagement(10000, stats());
    expect(er.alert).toBe(false);
  });

  it('marks a short session as not yet measurable', () => {
    const er = getChatEngagement(10000, stats({ sessionMs: 60_000 }));
    expect(er.measurable).toBe(false);
    expect(er.alert).toBe(false);
  });

  it('ignores small streams for the alert', () => {
    const er = getChatEngagement(500, stats({ cleanUsers: 2, activeUsers: 3 }));
    expect(er.alert).toBe(false);
  });
});

describe('getLoadingProgress', () => {
  it('is 100% once every gate passes', () => {
    const loading = getLoadingProgress(stats());
    expect(loading.ready).toBe(true);
    expect(loading.percent).toBe(100);
    expect(loading.done).toBe(3);
    expect(loading.required).toBe(3);
  });

  it('starts at 0% and never reports ready early', () => {
    const loading = getLoadingProgress({
      sessionMs: 0,
      cleanUsers: 0,
      windowMessages: 0,
    });
    expect(loading.percent).toBe(0);
    expect(loading.ready).toBe(false);
  });

  it('counts partial elapsed time toward the percentage', () => {
    const loading = getLoadingProgress({
      sessionMs: 30_000,
      cleanUsers: 0,
      windowMessages: 0,
    });
    expect(loading.percent).toBeGreaterThan(0);
    expect(loading.percent).toBeLessThan(50);
  });

  it('never shows 100% before it is ready', () => {
    const loading = getLoadingProgress({
      sessionMs: 119_000,
      cleanUsers: 1,
      windowMessages: 4,
    });
    expect(loading.ready).toBe(false);
    expect(loading.percent).toBeLessThanOrEqual(99);
  });
});

describe('classifyViewerSignals', () => {
  const base = {
    range: { low: 1000, high: 2000, confidence: 'high' },
    engagement: { alert: false, belowOrganicBand: false },
    churn: { churnActive: false },
    isBotWave: false,
    stats: stats(),
  };

  it('rates low ER plus churn as critical', () => {
    const verdict = classifyViewerSignals({
      ...base,
      engagement: { alert: true },
      churn: { churnActive: true },
    });
    expect(verdict.level).toBe('critical');
    expect(verdict.labelKey).toBe('verdict.low-er-and-churn');
  });

  it('rates churn alone as a warning', () => {
    const verdict = classifyViewerSignals({
      ...base,
      churn: { churnActive: true },
    });
    expect(verdict.level).toBe('warn');
  });

  it('rates low ER alone as a warning', () => {
    const verdict = classifyViewerSignals({
      ...base,
      engagement: { alert: true },
    });
    expect(verdict.level).toBe('warn');
  });

  it('reports a bot wave when nothing else fired', () => {
    const verdict = classifyViewerSignals({ ...base, isBotWave: true });
    expect(verdict.key).toBe('bot-wave');
  });

  it('reports no data when there is no range', () => {
    const verdict = classifyViewerSignals({ ...base, range: null });
    expect(verdict.level).toBe('unknown');
  });

  it('reports a clean stream otherwise', () => {
    const verdict = classifyViewerSignals(base);
    expect(verdict.level).toBe('ok');
  });

  it('renders labels through the translator', () => {
    expect(verdictLabel({ labelKey: 'verdict.clean' }, (key) => 'X:' + key)).toBe(
      'X:verdict.clean'
    );
    expect(verdictLabel(null)).toBe('');
  });
});

describe('buildViewerModel', () => {
  it('assembles the model consumed by the counter and tooltip', () => {
    // 1000 chatters at 8 000 viewers is ~12.5% engagement: healthy.
    const model = buildViewerModel({ official: 8000, stats: stats() });
    expect(model.official).toBe(8000);
    expect(model.range.low).toBe(8000);
    expect(model.loading.ready).toBe(true);
    expect(model.verdict.level).toBe('ok');
  });

  it('flags a big stream whose chat engagement is far below the 8-12.5% band', () => {
    // 1000 chatters at 56 090 viewers is ~1.8% — a genuine low-ER warning.
    const model = buildViewerModel({ official: 56090, stats: stats() });
    expect(model.engagement.percent).toBeLessThan(2.5);
    expect(model.verdict.level).toBe('warn');
    expect(model.verdict.key).toBe('low-er');
  });

  it('returns null without a usable official count', () => {
    expect(buildViewerModel({ official: 0, stats: stats() })).toBe(null);
    expect(buildViewerModel({ official: 'x', stats: stats() })).toBe(null);
  });

  it('uses the median for the range but the live count for ER', () => {
    const model = buildViewerModel({
      official: 20000,
      stats: stats({ cleanUsers: 1000, activeUsers: 1100 }),
      history: { median: 40000, churnEvents: 0 },
    });
    expect(model.stableOfficial).toBe(40000);
    expect(model.range.low).toBe(8000);
    expect(model.engagement.officialViewers).toBe(20000);
  });

  it('documents its assumptions explicitly', () => {
    expect(VIEWER_ESTIMATE_DEFAULTS.viewersPerChatterLow).toBe(8);
    expect(VIEWER_ESTIMATE_DEFAULTS.viewersPerChatterHigh).toBe(12.5);
    expect(VIEWER_ESTIMATE_DEFAULTS.erAlertPercent).toBe(2.5);
  });
});

it.each([[9500, 11000, 9500], [11000, 9500, 9500], [9500, undefined, 9500]])(
  'caps the range for current %s and median %s at %s',
  (official, median, cap) => {
    const model = buildViewerModel({ official, history: { median }, stats: stats() });
    expect(model.range.high).toBe(cap);
    expect(model.stableOfficial).toBe(median ?? official);
  },
);
