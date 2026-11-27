import { expect, it } from 'vitest';
import { SessionCapture } from '../../src/analysis/session-capture.ts';
import { completeSessionSnapshot } from '../../src/analysis/session-export.ts';
import { normalizeSettings } from '../../src/config/settings-model.ts';

it('merges restored samples and observation intervals into schema version 3', () => {
  const capture = new SessionCapture('example', 1000);
  capture.viewerSamples.push({ ts: 3000, value: 200 }, { ts: 4000, value: 300 });
  const snapshot = capture.snapshot(5000, [], { sessionMs: 4000 }, null, normalizeSettings({}));
  const result = completeSessionSnapshot({
    snapshot, broadcast: { channel: 'example', id: '1', startedAt: 1000 },
    previousSamples: [{ ts: 2000, value: 100 }, { ts: 3000, value: 150 }],
    checkpoint: { intervals: { chat: [[1000, 2500]], viewer: [[1000, 2000]] }, events: [] },
    confirmed: {}, bonuses: {}, chatIntervals: [[2000, 4000]], viewerIntervals: [[3000, 4000]],
    events: [{ kind: 'chat-wave', ts: 3500 }], groupRecurrence: null,
  });
  expect(result.schemaVersion).toBe(3);
  expect(result.viewerSamples).toEqual([{ ts: 2000, value: 100 }, { ts: 3000, value: 200 }, { ts: 4000, value: 300 }]);
  expect(result.observation).toEqual({ chat: [[1000, 4000]], viewer: [[1000, 2000], [3000, 4000]] });
  expect(result.broadcastEvents).toEqual([{ kind: 'chat-wave', ts: 3500 }]);
});
