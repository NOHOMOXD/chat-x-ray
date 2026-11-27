import type { GroupWindow, HistoryEvent, SavedModel, TimedSample } from './broadcast-checkpoint.ts';
import type { Interval } from './observation-clock.ts';

interface TimedEntry { ts: number }
export interface HistoryUpdate {
  intervals?: { chat?: Interval[]; viewer?: Interval[] };
  samples?: TimedSample[];
  groups?: GroupWindow[];
  bonuses?: Record<string, Record<string, TimedEntry>>;
  confirmed?: Record<string, TimedEntry>;
  events?: HistoryEvent[];
  lastViewerModel?: SavedModel | null;
}

export function afterClear(update: HistoryUpdate, clearedAt: number) {
  if (!clearedAt) return update;
  const newer = (items: HistoryEvent[] | undefined) => (items ?? []).filter((item) => item.ts > clearedAt);
  const covered = (items: Interval[] | undefined): Interval[] => (items ?? []).map(([from, to]) => [Math.max(from, clearedAt), to]);
  return {
    intervals: { chat: covered(update.intervals?.chat), viewer: covered(update.intervals?.viewer) },
    // ER and group observations each describe a full rolling window.
    samples: (update.samples ?? []).filter((item) => item.ts - 600000 >= clearedAt),
    groups: (update.groups ?? []).filter((item) => item.ts - 600000 >= clearedAt),
    bonuses: Object.fromEntries(Object.entries(update.bonuses ?? {}).map(([id, reasons]) =>
      [id, Object.fromEntries(Object.entries(reasons).filter(([, entry]) => entry.ts > clearedAt))])),
    confirmed: Object.fromEntries(Object.entries(update.confirmed ?? {}).filter(([, value]) => value.ts > clearedAt)),
    events: newer(update.events),
    lastViewerModel: update.lastViewerModel && update.lastViewerModel.sampledAt - 600000 >= clearedAt ? update.lastViewerModel : null,
  };
}


function objectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timed(value: unknown): value is TimedEntry & Record<string, unknown> {
  return objectValue(value) && typeof value.ts === 'number' && Number.isFinite(value.ts);
}

/** Check messages from content scripts before they reach the history writer. */
export function isHistoryUpdate(value: unknown): value is HistoryUpdate {
  if (!objectValue(value)) return false;
  const intervalsValid = (intervals: unknown) => Array.isArray(intervals) && intervals.every(interval =>
    Array.isArray(interval) && interval.length >= 2 &&
    typeof interval[0] === 'number' && typeof interval[1] === 'number');
  if (value.intervals !== undefined && (!objectValue(value.intervals) ||
      (value.intervals.chat !== undefined && !intervalsValid(value.intervals.chat)) ||
      (value.intervals.viewer !== undefined && !intervalsValid(value.intervals.viewer)))) return false;
  if (value.samples !== undefined && (!Array.isArray(value.samples) ||
      !value.samples.every(item => timed(item) && typeof item.er === 'number'))) return false;
  if (value.groups !== undefined && (!Array.isArray(value.groups) ||
      !value.groups.every(item => timed(item) && Array.isArray(item.groups) &&
        item.groups.every((group: unknown) => objectValue(group) && Array.isArray(group.memberIds))))) return false;
  if (value.events !== undefined && (!Array.isArray(value.events) ||
      !value.events.every(event => timed(event) && typeof event.kind === 'string'))) return false;
  if (value.confirmed !== undefined && (!objectValue(value.confirmed) ||
      !Object.values(value.confirmed).every(timed))) return false;
  if (value.bonuses !== undefined && (!objectValue(value.bonuses) ||
      !Object.values(value.bonuses).every(reasons => objectValue(reasons) && Object.values(reasons).every(timed)))) return false;
  if (value.lastViewerModel != null && (!objectValue(value.lastViewerModel) ||
      typeof value.lastViewerModel.sampledAt !== 'number')) return false;
  return true;
}
