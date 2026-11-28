import { expect, it, vi } from 'vitest';
import { ChatXRayApp } from '../../src/app/app-controller.ts';
import { broadcastProfile } from '../../src/analysis/broadcast-profile.ts';
import { createLiveSnapshot, restoreLiveSnapshot } from '../../src/analysis/live-state.ts';
import { ObservationClock } from '../../src/analysis/observation-clock.ts';

it('restores formula coverage only for the same broadcast and profile', () => {
  const identity = { channel: 'testchannel', id: '123', startedAt: null };
  const settings = { suspiciousThreshold: 30, roomProfile: 'open' };
  const profile = broadcastProfile(settings);
  const raw = createLiveSnapshot({ channel: identity.channel, identity, now: 10000,
    chat: [], viewer: [], formula: [[1000, 9000]], profile, model: null });
  const saved = restoreLiveSnapshot(raw, identity.channel, null, 10000);
  if (!saved) throw new Error('Missing saved snapshot');
  const clock = new ObservationClock();
  const host = {
    restoredTab: saved, broadcast: { ...identity, id: '456' }, formulaClock: clock,
    historySettings: () => settings,
  };
  const restore = ChatXRayApp.prototype.restoreTabCoverage.bind(host as unknown as ChatXRayApp);
  restore();
  expect(clock.snapshot()).toEqual([]);
  host.broadcast = identity;
  host.historySettings = () => ({ ...settings, suspiciousThreshold: 50 });
  restore();
  expect(clock.snapshot()).toEqual([]);
  host.historySettings = () => settings;
  restore();
  expect(clock.snapshot()).toEqual([[1000, 9000]]);
  expect(saved.formula).toEqual([]);
});

it('keeps the original profile and formula while the broadcast identity is pending', () => {
  const identity = { channel: 'testchannel', id: '123', startedAt: null };
  const settings = { suspiciousThreshold: 30, roomProfile: 'open' };
  const profile = broadcastProfile(settings);
  const raw = createLiveSnapshot({ channel: identity.channel, identity, now: 10000,
    chat: [], viewer: [], formula: [[1000, 9000]], profile, model: null });
  const saved = restoreLiveSnapshot(raw, identity.channel, null, 10000);
  if (!saved) throw new Error('Missing saved snapshot');
  const saveTab = vi.fn().mockResolvedValue(true);
  const host = {
    liveReady: true, channel: identity.channel, tabLease: 'lease', offline: false, clearingHistory: false,
    pendingTabSnapshot: null, broadcast: null, restoredTab: saved,
    historySettings: () => ({ ...settings, suspiciousThreshold: 50 }),
    formulaClock: new ObservationClock(), chatClock: new ObservationClock(), viewerClock: new ObservationClock(),
    viewerCounter: { recentMeasurement: null, lastMeasurement: null }, broadcastData: null,
    observedEvents: [], restoredRows: [], analyzer: { session: { records: [] }, confirmed: {}, bonuses: {} },
    historyClearedAt: 0, restoredSamples: () => [], broadcastHistory: { saveTab },
  };
  ChatXRayApp.prototype.persistLiveState.call(host as unknown as ChatXRayApp, 11000);
  expect(saveTab).toHaveBeenCalledWith('lease', expect.objectContaining({
    identity, profile, formula: [[1000, 9000]],
  }));
});
