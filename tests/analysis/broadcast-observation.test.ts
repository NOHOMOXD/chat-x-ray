import { expect, it } from 'vitest';
import { assessBroadcastModel, collectBroadcastGroups, prepareBroadcastUpdate } from '../../src/analysis/broadcast-observation.ts';
import type { CounterModel } from '../../src/ui/chat/viewer-counter.ts';
import type { waveEvidence } from '../../src/core/wave-evidence.ts';

it('requires ten minutes of both observation clocks and a fresh compatible model', () => {
  const model: CounterModel = {
    historyProfile: 'profile', chatConnected: true, sampledAt: 600000, chatAccess: 'open', mixedMode: false,
    engagement: { percent: 4, ratio: 0.04, cleanChatters: 40, officialViewers: 1000,
      thresholdPercent: 2.5, measurable: true, alert: false, belowOrganicBand: true },
  };
  const input = { model, profile: 'profile', roomSince: 0, chatSince: 0, viewerSince: 0, now: 600000 };
  expect(assessBroadcastModel(input)).toEqual({ compatible: true, complete: true });
  expect(assessBroadcastModel({ ...input, viewerSince: 1 }).complete).toBe(false);
  expect(assessBroadcastModel({ ...input, now: 606001 }).complete).toBe(false);
  expect(assessBroadcastModel({ ...input, profile: 'other' })).toEqual({ compatible: false, complete: false });
});

it('includes recent wave groups only while chat is connected', () => {
  type Wave = ReturnType<typeof waveEvidence>['wave'];
  const wave: Wave = { order: [10, 20], outsideCount: 25,
    rare: [{ text: 'rare phrase', substantive: true, memberIds: [10, 20], outsideAuthors: 0 }] };
  const waves = new Map([[1000, wave]]);
  expect(collectBroadcastGroups([], waves, 1000, false)).toBeNull();
  expect(collectBroadcastGroups([], waves, 1000, true)?.groups).toMatchObject([
    { from: 10, to: 20, memberIds: [10, 20] },
  ]);
  expect(collectBroadcastGroups([], waves, 601001, true)?.groups).toEqual([]);
});


it('prepares a private history update without sharing mutable bonus or event data', () => {
  const bonuses = { '1': { returning: { ts: 5, trigger: { key: 'returning', points: 10 } } } };
  const model: CounterModel = { sampledAt: 100, historyProfile: 'p', input: { private: true },
    engagement: { percent: 4, ratio: 0.04, cleanChatters: 40, officialViewers: 1000,
      thresholdPercent: 2.5, measurable: true, alert: false, belowOrganicBand: true } };
  const update = prepareBroadcastUpdate({ now: 100, model, compatible: true, complete: true,
    confirmed: {}, bonuses, chatIntervals: [[1, 100]], viewerIntervals: [[2, 100]],
    events: [{ kind: 'chat-wave', ts: 90, atTrigger: { private: true } }],
  });
  expect(update.samples).toEqual([{ ts: 100, er: 4 }]);
  expect(update.lastViewerModel?.input).toBeUndefined();
  expect(update.events).toEqual([{ kind: 'chat-wave', ts: 90 }]);
  bonuses['1'].returning.trigger.points = 20;
  expect(update.bonuses['1']).toMatchObject({ returning: { trigger: { points: 10 } } });
});
