import { broadcastKey, broadcastProfile, sameBroadcast, startedAt, priorBroadcast } from './broadcast-profile.ts';
import type { BroadcastIdentity, BroadcastProfileSettings } from './broadcast-profile.ts';
import { medianNumber } from './er-baseline.ts';
import { checkpointMerge, mergeSamples } from './broadcast-checkpoint.ts';
import type { TimedSample } from './broadcast-checkpoint.ts';

const MAX_BROADCASTS_PER_CHANNEL = 20;

export interface BroadcastRecord extends BroadcastIdentity {
  profiles: Record<string, TimedSample[]>;
  checkpoint: ReturnType<typeof checkpointMerge>;
  updatedAt: number;
}

function quantile(sorted: number[], fraction: number) {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const first = sorted[lower];
  const second = sorted[Math.ceil(index)];
  if (first === undefined || second === undefined) return null;
  return first + (second - first) * (index - lower);
}

export function historySnapshot(records: BroadcastRecord[], identity: BroadcastIdentity, settings: BroadcastProfileSettings) {
  const profile = broadcastProfile(settings);
  const current = records.filter((item) => sameBroadcast(item, identity));
  const earlier = records.filter((item) => item.channel === identity.channel && priorBroadcast(item, current[0] ?? identity))
    .sort((a, b) => startedAt(b) - startedAt(a));
  const values = earlier.map((item) => medianNumber(item.profiles[profile]?.map(({ er }) => er)))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  let checkpoint: (ReturnType<typeof checkpointMerge> & { samples: TimedSample[] }) | null = null;
  if (current.length) {
    const merged = current.reduce((combined, item) => checkpointMerge(combined, item.checkpoint), checkpointMerge());
    checkpoint = { ...merged, samples: current.reduce<TimedSample[]>((all, item) =>
      mergeSamples(all, item.profiles[profile] ?? []), []) };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const hasRange = values.length >= 5;
  return {
    checkpoint,
    baseline: values.length ? {
      er: hasRange ? medianNumber(values) : values[0],
      lastEr: values[0],
      sessions: values.length,
      low: hasRange ? quantile(sorted, 0.25) : null,
      high: hasRange ? quantile(sorted, 0.75) : null,
    } : null,
    history: records.filter((item) => priorBroadcast(item, current[0] ?? identity) &&
      (item.channel === identity.channel || item.checkpoint?.groups?.some((observation) => observation.groups?.length)))
      .sort((a, b) => startedAt(b) - startedAt(a))
      .slice(0, MAX_BROADCASTS_PER_CHANNEL).map(({ channel, id, startedAt, checkpoint }) => ({
      channel, id: id || broadcastKey({ channel, startedAt }), startedAt,
      confirmed: checkpoint.confirmed, groupObservations: checkpoint.groups,
    })),
  };
}

export function retainChannel(records: BroadcastRecord[]) {
  const retainedProfiles = new Map<string, number>();
  const newestFirst = records.sort((a, b) => startedAt(b) - startedAt(a));
  const retained: BroadcastRecord[] = [];
  for (const [index, record] of newestFirst.entries()) {
    const profiles: Record<string, TimedSample[]> = {};
    for (const [key, samples] of Object.entries(record.profiles)) {
      const count = retainedProfiles.get(key) ?? 0;
      if (count >= MAX_BROADCASTS_PER_CHANNEL || !samples.length) continue;
      retainedProfiles.set(key, count + 1);
      profiles[key] = samples;
    }
    if (index < MAX_BROADCASTS_PER_CHANNEL) {
      retained.push({ ...record, profiles });
    } else if (Object.keys(profiles).length) {
      retained.push({ ...record, profiles, checkpoint: checkpointMerge() });
    }
  }
  return retained;
}

