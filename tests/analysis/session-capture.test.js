import { expect, it } from 'vitest';
import { SessionCapture } from '../../src/analysis/session-capture.js';
import { DEFAULTS } from '../../src/config/settings.js';

it('exports ordinary messages, preserves minute history and measures age discount crossings', () => {
  const start = 1_000_000;
  const settings = { ...DEFAULTS, clientR9K: true, muteSuspicious: true };
  const capture = new SessionCapture('example', start);
  capture.updateSettings(settings, start);
  const stats = { sessionMs: 600_000, audienceMessages: 5, activeUsers: 3, cleanUsers: 2 };
  const model = { official: 10_000, stableOfficial: 10_000 };
  const rows = [
    { userKey: 'before', ts: start - 10, botScore: 0, triggers: [] },
    { userKey: 'regular', ts: start + 100, botScore: 0, triggers: [] },
    {
      userKey: 'veteran', ts: start + 200, botScore: 25, accountAgeSource: 'api',
      triggers: [{ key: 'veteran-account', points: -15 }], isR9KDuplicate: true,
    },
    {
      userKey: 'suspect', ts: start + 300, botScore: 35,
      triggers: [], isR9KDuplicate: true,
    },
  ];
  capture.observe(start + 600_000, stats, model, rows, settings, null);
  const snapshot = capture.snapshot(start + 600_000, rows, stats, model, settings);
  expect(snapshot.channel).toBe('example');
  expect(snapshot.current.messages.map((row) => row.userKey)).toEqual(['regular', 'veteran', 'suspect']);
  expect(snapshot.minutes[0].diagnostics).toMatchObject({
    actions: { r9kOnly: 1, scoreOnly: 0, both: 1 },
    ageSources: { api: 1 },
    ageDiscountCrossings: 1,
    thresholds: [
      { threshold: 10, cleanUsers: 1 },
      { threshold: 25, cleanUsers: 1 },
      { threshold: 30, cleanUsers: 2 },
      { threshold: 50, cleanUsers: 3 },
    ],
  });
});

it('preserves the last viewer measurement and freezes wave totals at export', () => {
  const capture = new SessionCapture('example', 1000);
  const model = { sampledAt: 2000, official: 27000 };
  capture.recordModel(model);
  const wave = { kind: 'chat-wave', ts: 2000, messages: 80, authors: 55 };
  capture.events.push(wave);
  const snapshot = capture.snapshot(3000, [], { sessionMs: 0 }, { ...model, stale: true }, DEFAULTS);
  wave.messages += 1;
  expect(snapshot.current.model).toBeNull();
  expect(snapshot.lastViewerModel).toEqual(model);
  expect(snapshot.events).toEqual([{ kind: 'chat-wave', ts: 2000, messages: 80, authors: 55 }]);
});
