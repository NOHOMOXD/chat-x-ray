export const MAX_OBSERVATION_GAP = 60000;

export class ObservationClock {
  constructor() {
    this.since = null;
    this.last = null;
    this.intervals = [];
  }

  observe(now) {
    if (this.last !== null && now - this.last > MAX_OBSERVATION_GAP) this.pause();
    this.since ??= now;
    this.last = now;
  }

  pause() {
    if (this.since !== null && this.last > this.since) {
      this.intervals.push([this.since, this.last]);
    }
    this.since = this.last = null;
  }

  snapshot() {
    return this.last > this.since
      ? [...this.intervals, [this.since, this.last]]
      : this.intervals.slice();
  }
}

export function coveredDuration(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let end = -Infinity;
  let duration = 0;
  for (const [start, stop] of sorted) {
    duration += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return duration;
}
