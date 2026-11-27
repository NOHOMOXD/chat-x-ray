import { describeGroups, findIdGroups } from '../core/id-group-diagnostics.ts';
import type { AnalyzerRecord } from '../core/analyzer-record.ts';
import type { waveEvidence } from '../core/wave-evidence.ts';
import type { buildGroupObservation } from './group-history.ts';
import type { CounterModel } from '../ui/chat/viewer-counter.ts';
import type { HistoryEvent } from './broadcast-checkpoint.ts';
import type { HistoryUpdate } from './broadcast-history-clear.ts';
import type { Interval } from './observation-clock.ts';

type Wave = ReturnType<typeof waveEvidence>['wave'];
type GroupInput = Parameters<typeof buildGroupObservation>[0];

/** A model is complete only after both chat and viewer clocks cover ten minutes. */
export function assessBroadcastModel(input: {
  model: CounterModel | null;
  profile: string;
  roomSince: number;
  chatSince: number | null;
  viewerSince: number | null;
  now: number;
}) {
  const { model, profile, roomSince, chatSince, viewerSince, now } = input;
  const compatible = Boolean(model && model.historyProfile === profile && model.chatConnected &&
    typeof model.sampledAt === 'number' && model.sampledAt >= roomSince);
  const complete = Boolean(compatible && model && !model.mixedMode && model.chatAccess !== 'unknown' &&
    model.engagement?.measurable && chatSince !== null && now - chatSince >= 600000 &&
    viewerSince !== null && now - viewerSince >= 600000 &&
    typeof model.sampledAt === 'number' && now - model.sampledAt <= 6000);
  return { compatible, complete };
}

/** Prepare current ID groups, including rare phrases retained from past waves. */
export function collectBroadcastGroups(records: AnalyzerRecord[], waves: Map<number, Wave>, now: number, chatConnected: boolean): GroupInput | null {
  if (!chatConnected) return null;
  const groups: GroupInput['groups'] = describeGroups(findIdGroups(records), records, true);
  for (const [start, wave] of waves) {
    if (start < now - 600000 || !wave.rare.length) continue;
    groups.push({
      memberIds: wave.order, from: Math.min(...wave.order), to: Math.max(...wave.order),
      outsideAuthorCount: wave.outsideCount, phrases: wave.rare,
    });
  }
  return { groups };
}

interface BroadcastUpdateInput {
  now: number;
  model: CounterModel | null;
  compatible: boolean;
  complete: boolean;
  confirmed: NonNullable<HistoryUpdate['confirmed']>;
  bonuses: NonNullable<HistoryUpdate['bonuses']>;
  chatIntervals: Interval[];
  viewerIntervals: Interval[];
  events: HistoryEvent[];
}

function savedWave(value: unknown) {
  if (value == null) return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return {
    kind: 'chat-wave',
    ts: 'ts' in value ? value.ts : undefined,
    bucketStart: 'bucketStart' in value ? value.bucketStart : undefined,
    authors: 'authors' in value ? value.authors : undefined,
    messages: 'messages' in value ? value.messages : undefined,
  };
}

/** Build the history update without retaining private model inputs or trigger details. */
export function prepareBroadcastUpdate(input: BroadcastUpdateInput) {
  const { model, compatible, complete, now } = input;
  const er = model?.engagement?.percent;
  const sampledAt = model?.sampledAt;
  const groups: Awaited<ReturnType<typeof buildGroupObservation>>[] = [];
  return {
    confirmed: { ...input.confirmed },
    bonuses: structuredClone(input.bonuses),
    intervals: { chat: input.chatIntervals, viewer: input.viewerIntervals },
    samples: complete && typeof er === 'number' ? [{ ts: now, er }] : [],
    events: structuredClone(input.events.map(({ atTrigger, ...event }) => event)),
    groups,
    lastViewerModel: compatible && model && typeof sampledAt === 'number' ? {
      ...model, sampledAt, rangeVersion: 1, input: undefined,
      lastWave: savedWave(model.lastWave),
    } : null,
  };
}
