import type { Analyzer } from '../core/analyzer.ts';
import type { ChatRecord } from '../core/chat-session.ts';
import type { HistoryEvent } from '../analysis/broadcast-checkpoint.ts';
import type { RoomMode } from '../platform/chat-mode.ts';
import type { Interval } from '../analysis/observation-clock.ts';
import { chatAccess, modeProfile } from '../platform/chat-mode.ts';
import { median } from '../analysis/viewer-statistics.ts';
import { coveredDuration, mergeIntervals } from '../analysis/observation-clock.ts';
import { observedWindow, resumedWindow } from '../analysis/live-state.ts';

interface ViewerStatsInput {
  now: number;
  displayWindow: boolean;
  chatSince: number | null;
  roomSince: number;
  channelChangedAt: number;
  roomMode: RoomMode;
  observedEvents: HistoryEvent[];
  persistedEvents: HistoryEvent[];
  records: ChatRecord[];
  restoredRows: ChatRecord[];
  threshold: number;
  stats: ReturnType<Analyzer['getStats']>;
  hasBroadcast: boolean;
  formulaCoverage: Interval[];
  chatCoverage: Interval[];
  persistedChatCoverage: unknown[];
  hasRestoredSamples: boolean;
  restoredSamples: () => Array<{ ts: number; value: number }>;
}

function readRoomMode(value: unknown): RoomMode | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const mode: RoomMode = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((key === 'subscribers' || key === 'followers' || key === 'slow' || key === 'emotes' || key === 'unique') &&
        typeof entry === 'number' && Number.isFinite(entry)) mode[key] = entry;
  }
  return mode;
}

/** Combine live statistics with a restored display window and observation coverage. */
export function buildViewerStats(input: ViewerStatsInput) {
  const { now, stats, chatSince, roomSince, roomMode } = input;
  const since = chatSince ?? now;
  const window = chatSince !== null && input.hasBroadcast ? resumedWindow(input.formulaCoverage, now) : null;
  const resumed = window !== null && window.start < since;
  const windowStart = resumed ? window.start : Math.max(since, now - 600000);
  const inWindow = (timestamp: number) => input.formulaCoverage.some(([from, to]) =>
    timestamp >= Math.max(from, windowStart) && timestamp <= to);
  const mixedMode = input.observedEvents.some(event => event.kind === 'room-mode' && event.ts > windowStart && event.ts <= now);
  const windowModes = new Map<string, RoomMode | undefined>();
  if (mixedMode) {
    for (const event of input.observedEvents) {
      if (event.kind !== 'room-mode' || event.ts <= windowStart || event.ts > now) continue;
      for (const mode of [readRoomMode(event.from), readRoomMode(event.to)]) windowModes.set(modeProfile(mode), mode);
    }
  }
  let displayed: ReturnType<typeof observedWindow> = stats;
  if (input.restoredRows.length) {
    displayed = observedWindow(input.records, input.restoredRows, now, input.threshold);
  }
  if (resumed) {
    displayed = observedWindow(input.records.filter(record => inWindow(record.receivedAt ?? record.ts)),
      input.restoredRows.filter(record => inWindow(record.receivedAt ?? record.ts)), now, input.threshold, window.start);
  }
  const waves = new Map<number | undefined, HistoryEvent>();
  for (const event of [...input.persistedEvents, ...input.observedEvents]) {
    if (event.kind === 'chat-wave') waves.set(event.bucketStart, event);
  }
  return {
    ...stats, ...((input.displayWindow || resumed) && displayed !== stats ? displayed : {}),
    sessionMs: resumed ? window.duration : stats.sessionMs,
    observedMinutes: Math.round(((resumed ? window.duration : stats.sessionMs) / 60000) * 10) / 10,
    sessionUsers: stats.sessionUsers,
    resumedViewerMedian: resumed && input.hasRestoredSamples
      ? median(input.restoredSamples().filter(sample => inWindow(sample.ts)).map(sample => sample.value)) : null,
    observedChatters: displayed.activeUsers - displayed.serviceBots,
    observedAudienceMessages: displayed.audienceMessages, massCommand: displayed.massCommand,
    roomMode, chatAccess: chatAccess(roomMode), windowSince: since, mixedMode, windowModes: [...windowModes.values()],
    waveCount: Math.max(stats.waveCount, waves.size),
    lastWave: stats.lastWave ?? [...waves.values()].at(-1),
    observationMs: coveredDuration(mergeIntervals([...input.persistedChatCoverage, ...input.chatCoverage])),
    tabMs: Math.max(0, now - input.channelChangedAt),
    chatConnected: chatSince !== null,
  };
}
