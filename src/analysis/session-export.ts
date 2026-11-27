import { checkpointMerge } from './broadcast-checkpoint.ts';
import type { Checkpoint, HistoryEvent } from './broadcast-checkpoint.ts';
import type { Interval } from './observation-clock.ts';
import type { SessionCapture } from './session-capture.ts';
import type { BroadcastIdentity } from './broadcast-profile.ts';
import type { analyzeGroupRecurrence } from './group-history.ts';

type SessionSnapshot = ReturnType<SessionCapture['snapshot']>;
type ViewerSample = SessionSnapshot['viewerSamples'][number];

interface SessionExportInput {
  snapshot: SessionSnapshot;
  broadcast: BroadcastIdentity | null;
  previousSamples: ViewerSample[] | null;
  checkpoint: Checkpoint | null | undefined;
  confirmed: NonNullable<Checkpoint['confirmed']>;
  bonuses: NonNullable<Checkpoint['bonuses']>;
  chatIntervals: Interval[];
  viewerIntervals: Interval[];
  events: HistoryEvent[];
  groupRecurrence: ReturnType<typeof analyzeGroupRecurrence> | null;
}

/** Add broadcast observation to the current session export, retaining schema version 3. */
export function completeSessionSnapshot(input: SessionExportInput) {
  const { snapshot, previousSamples } = input;
  const samples = previousSamples === null ? snapshot.viewerSamples :
    [...new Map([...previousSamples, ...snapshot.viewerSamples].map(sample => [sample.ts, sample])).values()]
      .sort((a, b) => a.ts - b.ts);
  const checkpoint = checkpointMerge(input.checkpoint ?? {}, {
    confirmed: input.confirmed, bonuses: input.bonuses,
    intervals: { chat: input.chatIntervals, viewer: input.viewerIntervals }, events: input.events,
  });
  return {
    ...snapshot, broadcast: input.broadcast, viewerSamples: samples,
    observation: checkpoint.intervals, broadcastEvents: checkpoint.events,
    ...(input.groupRecurrence ? { groupRecurrence: input.groupRecurrence } : {}),
  };
}
