export const MAX_OBSERVATION_GAP = 60000;

/**
 * Normalize a coverage list: drop invalid and empty intervals, sort and merge
 * overlaps. Shared by the clocks and by the broadcast checkpoint, so a reload
 * that restores saved intervals and the live page produce the same shape.
 */
export type Interval = [start: number, end: number];

export function mergeIntervals(intervals: unknown): Interval[] {
  const sorted = (Array.isArray(intervals) ? intervals : [])
    .filter((item): item is Interval => Array.isArray(item) && item.length >= 2 &&
      typeof item[0] === 'number' && typeof item[1] === 'number' &&
      Number.isFinite(item[0]) && Number.isFinite(item[1]) && item[1] > item[0])
    .sort(([a], [b]) => a - b);
  const merged: Interval[] = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(end, last[1]);
    else merged.push([start, end]);
  }
  return merged;
}

export class ObservationClock {
  since: number | null = null;
  last: number | null = null;
  intervals: Interval[] = [];

  observe(now: number) {
    if (this.last !== null && now - this.last > MAX_OBSERVATION_GAP) this.pause();
    this.since ??= now;
    this.last = now;
  }

  pause() {
    if (this.since !== null && this.last !== null && this.last > this.since) {
      this.intervals.push([this.since, this.last]);
    }
    this.since = this.last = null;
  }

  includeCoverage(intervals: unknown[]) {
    // A saved interval is historical evidence. Only observe() can start or
    // extend the current connection. The period spent reloading stays a gap.
    this.intervals = mergeIntervals([...this.intervals, ...intervals]);
  }

  snapshot(now?: number): Interval[] {
    const end = now !== undefined && this.last !== null && now >= this.last &&
      now - this.last <= MAX_OBSERVATION_GAP ? now : this.last;
    return end !== null && this.since !== null && end > this.since
      ? [...this.intervals, [this.since, end]]
      : this.intervals.slice();
  }
}

export function coveredDuration(intervals: Interval[]) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let end = -Infinity;
  let duration = 0;
  for (const [start, stop] of sorted) {
    duration += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return duration;
}
