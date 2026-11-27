import { expect, it } from 'vitest';
import { Analyzer } from '../../src/core/analyzer.ts';
import { buildViewerStats } from '../../src/app/viewer-stats.ts';

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
