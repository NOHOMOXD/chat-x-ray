import { expect, it } from 'vitest';
import { Analyzer } from '../../src/core/analyzer.ts';
import { buildViewerStats } from '../../src/app/viewer-stats.ts';
import { ObservationClock } from '../../src/analysis/observation-clock.ts';
import { buildViewerModel } from '../../src/analysis/viewer-estimate.ts';

it('combines live and restored chat only within the resumed observation window', () => {
  const now = 120000;
  const analyzer = new Analyzer();
  analyzer.ingest({ id: 'live', login: 'live', text: 'hello', ts: 90000, receivedAt: 90000 }, 90000);
  const stats = analyzer.getStats(now, 60000);
  const result = buildViewerStats({
    now, stats, displayWindow: false, chatSince: 60000, roomSince: 0, channelChangedAt: 60000,
    roomMode: { subscribers: 0, followers: -1 }, observedEvents: [], persistedEvents: [],
    records: analyzer.session.records,
    restoredRows: [{ id: 'saved', ts: 30000, receivedAt: 30000, userKey: 'saved', botScore: 0 }],
    threshold: 30, hasBroadcast: true, formulaCoverage: [[0, now]], chatCoverage: [[60000, now]],
    persistedChatCoverage: [[0, 30000]], hasRestoredSamples: true,
    restoredSamples: () => [{ ts: 30000, value: 100 }, { ts: 90000, value: 300 }],
  });
  expect(result).toMatchObject({
    activeUsers: 2, observedChatters: 2, sessionMs: 120000, resumedViewerMedian: 200,
    observationMs: 90000, chatConnected: true, chatAccess: 'open',
  });
});

it('reports a full window after the reload gap leaves it, between maintenance ticks', () => {
  const now = 902001;
  const analyzer = new Analyzer();
  const clock = new ObservationClock();
  clock.includeCoverage([[0, 300000]]);
  clock.observe(302000);
  for (let time = 360000; time < now - 1; time += 50000) clock.observe(time);
  clock.observe(now - 1);
  const stats = analyzer.getStats(now, 400000);
  const result = buildViewerStats({
    now, stats, displayWindow: false, chatSince: 400000, roomSince: 0, channelChangedAt: 302000,
    roomMode: { subscribers: 0, followers: -1 }, observedEvents: [], persistedEvents: [],
    records: [], restoredRows: [], threshold: 30, hasBroadcast: true,
    formulaCoverage: clock.snapshot(now), chatCoverage: [], persistedChatCoverage: [],
    hasRestoredSamples: false, restoredSamples: () => [],
  });
  expect(result.sessionMs).toBe(600000);
  const model = buildViewerModel({ official: 1000, stats: { ...result, cleanUsers: 10, activeUsers: 10, audienceMessages: 10 } });
  expect(model?.range?.confidence).toBe('high');
});

it('keeps restored duration and mode changes consistent with live session totals', () => {
  const now = 915000;
  const analyzer = new Analyzer();
  analyzer.ingest({ id: 'one', login: 'one', text: 'hello', ts: now - 1 }, now - 1);
  const stats = analyzer.getStats(now, 900000);
  const result = buildViewerStats({
    now, stats, displayWindow: false, chatSince: 900000, roomSince: 900000,
    channelChangedAt: 900000, roomMode: { subscribers: 0, followers: -1 },
    observedEvents: [{ kind: 'room-mode', ts: 860000, from: { subscribers: 1 }, to: { subscribers: 0 } }],
    persistedEvents: [], records: analyzer.session.records, restoredRows: [], threshold: 30,
    hasBroadcast: true, formulaCoverage: [[200000, 898000], [900000, now]],
    chatCoverage: [], persistedChatCoverage: [], hasRestoredSamples: false, restoredSamples: () => [],
  });
  expect(result).toMatchObject({ sessionMs: 600000, observedMinutes: 10, sessionUsers: 1, mixedMode: true });
  expect(result.windowModes).toHaveLength(2);
});
