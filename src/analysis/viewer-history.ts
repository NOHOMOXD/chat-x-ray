import { erPercent, median } from './viewer-statistics.ts';
/*
 * Twitch Chat X-Ray — official viewer-count history.
 *
 * Twitch's viewer number is the only public signal about the video audience,
 * and bot farms make it oscillate: 50 000 → 40 000 → 50 000 as rented bots
 * expire and are replaced. This module keeps a bounded sample history and
 * detects those drop-and-recover cycles ("churn") without touching the number
 * Twitch displays.
 *
 * The smoothed median is also used as the denominator/cap for the chat-based
 * estimate, so the estimate itself does not jump with the official counter.
 */
export const VIEWER_HISTORY_DEFAULTS = Object.freeze({
  maxGapMs: 60000,
  surgeWindowMs: 120000,
  retainMs: 15 * 60 * 1000,
  medianWindowMs: 10 * 60 * 1000,
  maxSamples: 400,
  minSampleIntervalMs: 3000,
  // A recovery within 2% of the pre-drop peak confirms a refill event.
  recoveryRatio: 0.02,
  recoveryWindowMs: 5 * 60 * 1000,
  // A one-sample glitch must not become a churn event.
  dropConfirmMs: 15000,
  // Optional: ignore samples for the first N ms of a channel session. The
  // controller enables this on a channel switch because Twitch keeps the
  // previous channel's viewer count in the header while the SPA swaps pages.
  // Default 0 keeps the pure history behaviour unchanged in tests.
  warmupMs: 0,
  churnWindowMs: 15 * 60 * 1000,
  churnEventsForAlert: 2,
});

interface ViewerSample { ts: number; value: number; clean: number | null }
interface Raid { ts: number; id: string; [key: string]: unknown }
interface SurgeEvent {
  [field: string]: unknown;
  kind: 'surge'; ts: number; from: number; to: number; delta: number;
  startedAt?: number; confirmedAt?: number; peakTs?: number; durationMs?: number;
  fromTs?: number; beforeRate?: number | null; duringRate?: number | null;
  rateRatio?: number | null; raid?: Raid | null; precedingDrop?: { from: number; to: number; fromTs: number; ts: number } | null;
}
interface OutflowEvent {
  kind: 'viewer-outflow'; ts: number; from: number; startedAt?: number; raid?: Raid | null;
  fromTs?: number; confirmedAt?: number; status?: 'observing' | 'interrupted' | 'unrecovered' | 'recovered';
  to?: number; lowTs?: number; delta?: number; closedAt?: number; recoveredAt?: number;
}
interface ChurnAnomaly { [field: string]: unknown; kind: 'churn'; ts: number; from: number; to: number; delta: number; durationMs: number; fromTs?: number; lowTs?: number }
type ViewerEvent = SurgeEvent | OutflowEvent | ChurnAnomaly;
interface ChurnEvent { from: number; low: number; drop: number; startedAt: number; recoveredAt: number; durationMs: number; erBefore?: number | null; erAtLow?: number | null; erAfter?: number | null }
interface DropState { from: number; fromTs: number; at: number; low: number; lowTs: number; lowClean: number | null; erBefore: number | null; event?: OutflowEvent }
interface PendingRise { from: ViewerSample; at: number; peak: ViewerSample }
interface RecordMeta { cleanUsers?: number; countMessages?: (from: number, to: number) => number | null }
type ViewerHistoryOptions = { [K in keyof typeof VIEWER_HISTORY_DEFAULTS]?: number };

function isViewerEvent(value: unknown): value is ViewerEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      !('kind' in value) || !('ts' in value) || !('from' in value) ||
      typeof value.ts !== 'number' || !Number.isFinite(value.ts) ||
      typeof value.from !== 'number' || !Number.isFinite(value.from)) return false;
  if (value.kind === 'viewer-outflow') {
    return !('status' in value) || value.status === undefined ||
      value.status === 'observing' || value.status === 'interrupted' ||
      value.status === 'unrecovered' || value.status === 'recovered';
  }
  if (value.kind !== 'surge' && value.kind !== 'churn') return false;
  if (!('to' in value) || !('delta' in value) || typeof value.to !== 'number' ||
      !Number.isFinite(value.to) || typeof value.delta !== 'number' || !Number.isFinite(value.delta)) return false;
  return value.kind === 'surge' || ('durationMs' in value &&
    typeof value.durationMs === 'number' && Number.isFinite(value.durationMs));
}

function movementThreshold(a: number, b: number) {
  return Math.max(500, Math.min(3000, 0.3 * Math.min(a, b)));
}


export class ViewerHistory {
  options: { [K in keyof typeof VIEWER_HISTORY_DEFAULTS]: number };
  samples: ViewerSample[] = [];
  retentionStart = Infinity;
  raids: Raid[] = [];
  totalSurges = 0;
  surgeSum = 0;
  lastSurgeAt = -Infinity;
  lastSurge: SurgeEvent | null = null;
  anchors: ViewerSample[] = [];
  pendingRise: PendingRise | null = null;
  lastAnomaly: SurgeEvent | ChurnAnomaly | null = null;
  lastChurn: ChurnEvent | null = null;
  churnEvents: ChurnEvent[] = [];
  dropState: DropState | null = null;
  lastOutflow: OutflowEvent | null = null;
  totalOutflows = 0;
  dropBaselineAt = -Infinity;
  startedAt: number | null = null;
  totalChurnEvents = 0;
  totalDropSum = 0;
  totalMaxDrop = 0;

  constructor(options: ViewerHistoryOptions = {}) {
    this.options = Object.assign({}, VIEWER_HISTORY_DEFAULTS, options || {});
    this.reset();
  }

  reset() {
    this.samples = [];
    this.retentionStart = Infinity;
    this.raids = [];
    this.totalSurges = 0;
    this.surgeSum = 0;
    this.lastSurgeAt = -Infinity;
    this.lastSurge = null;
    this.anchors = [];
    this.pendingRise = null;
    this.lastAnomaly = null;
    this.lastChurn = null;
    this.churnEvents = [];
    this.dropState = null;
    this.lastOutflow = null;
    this.totalOutflows = 0;
    this.dropBaselineAt = -Infinity;
    this.startedAt = null;
    // Session totals are deliberately not pruned by the 15-minute recent
    // window: the user wants the whole stream's rollback count, not a count
    // that silently drops from 5 to 1 as events age out.
    this.totalChurnEvents = 0;
    this.totalDropSum = 0;
    this.totalMaxDrop = 0;
  }

  restoreEvents(input: unknown) {
    const events = Array.isArray(input) ? input.filter(isViewerEvent) : [];
    const collected = <K extends ViewerEvent['kind']>(kind: K) => events.filter((event): event is Extract<ViewerEvent, { kind: K }> => event.kind === kind)
      .sort((a, b) => a.ts - b.ts);
    const surges = collected('surge');
    const drops = collected('viewer-outflow');
    const churns = collected('churn');
    this.totalSurges = surges.length;
    this.surgeSum = surges.reduce((sum, event) => sum + event.delta, 0);
    // Preserve the live event object shared with the session capture as its peak grows.
    const savedSurge = surges.at(-1);
    if (savedSurge && this.lastSurge?.ts === savedSurge.ts) {
      if (savedSurge.to > this.lastSurge.to) Object.assign(this.lastSurge, savedSurge);
    } else {
      this.lastSurge = savedSurge ?? null;
      this.lastSurgeAt = -Infinity;
    }

    this.totalOutflows = drops.length;
    const drop = drops.at(-1);
    const active = this.dropState?.event;
    const locallyObserved = active && drop?.from === active.from && Math.abs(drop.ts - active.ts) <= 15000;
    this.lastOutflow = drop?.status === 'observing' && !locallyObserved
      ? { ...drop, status: 'interrupted', closedAt: drop.lowTs ?? drop.confirmedAt ?? drop.ts } : drop ?? null;

    this.totalChurnEvents = churns.length;
    this.totalDropSum = churns.reduce((sum, event) => sum - event.delta, 0);
    this.totalMaxDrop = churns.reduce((max, event) => Math.max(max, -event.delta), 0);
    const local = new Map(this.churnEvents.map((event) => [event.recoveredAt, event]));
    this.churnEvents = churns.map((event) => local.get(event.ts) ?? {
      from: event.from, low: event.to, drop: -event.delta,
      startedAt: event.ts - event.durationMs, recoveredAt: event.ts,
      durationMs: event.durationMs,
    });
    this.lastChurn = this.churnEvents.at(-1) ?? null;
    this.lastAnomaly = [this.lastSurge, churns.at(-1)].filter((event): event is SurgeEvent | ChurnAnomaly => Boolean(event))
      .sort((a, b) => a.ts - b.ts).at(-1) ?? null;
  }

  /**
   * Feed one parsed official viewer count. Samples are coalesced while the
   * number is unchanged, so a 15-minute history stays small.
   */
  record(value: number, now?: number, meta?: RecordMeta) {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    const time = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
    const last = this.samples[this.samples.length - 1];

    // Keep a sample at most every `minSampleIntervalMs`; unchanged values are
    // still sampled so the median is time-weighted rather than biased toward
    // whichever distinct values happened to occur most often in a chatty UI.
    if (last && time - last.ts < this.options.minSampleIntervalMs) {
      return;
    }
    if (this.startedAt === null) {
      this.startedAt = time;
    }
    // Do not even store the stale header of the previous channel: the first
    // sample after the warm-up becomes the new baseline.
    if (
      this.options.warmupMs > 0 &&
      time - this.startedAt < this.options.warmupMs
    ) {
      return;
    }

    // Clean chatter count is optional: with it we can show how the engagement
    // rate behaved across a rollback (e.g. 1% at the peak -> 3% after refill),
    // which is often more informative than the raw viewer numbers.
    const cleanUsers =
      typeof meta?.cleanUsers === 'number' && Number.isFinite(meta.cleanUsers) && meta.cleanUsers >= 0
        ? meta.cleanUsers
        : null;
    if (last && time - last.ts > this.options.maxGapMs) {
      this.interrupt();
    }
    const sample = { ts: time, value, clean: cleanUsers };
    this.samples.push(sample);

    this._trim(time);
    const short = this.samples.filter(point => point.ts >= this.dropBaselineAt && time - point.ts <= 20000);
    this.anchors = this.anchors.filter(point => time - point.ts <= this.options.surgeWindowMs);
    const firstShort = short[0];
    if (short.length >= 3 && firstShort && time - firstShort.ts >= 15000) {
      const value = median(short.map(point => point.value));
      if (value !== null) this.anchors.push({ ts: time, value, clean: cleanUsers });
    }
    const recovering = this.dropState?.event &&
      time - this.dropState.at <= this.options.recoveryWindowMs;
    const outflow = this._detectChurn(value, time, cleanUsers);
    if (recovering && !this.dropState) {
      this.lastSurgeAt = -Infinity;
    }
    if (recovering || this.dropState) this.pendingRise = null;
    if (!recovering && !this.dropState) {
      this._detectSurge(sample, meta?.countMessages);
    }
    return { sample, outflow, anomaly: this.lastAnomaly?.ts === time ? this.lastAnomaly : null };
  }

  getStats(now?: number) {
    const time = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
    this._trim(time);

    const medianCutoff = time - this.options.medianWindowMs;
    const recentValues = [];
    const allValues = [];
    for (const sample of this.samples) {
      allValues.push(sample.value);
      if (sample.ts >= medianCutoff) {
        recentValues.push(sample.value);
      }
    }

    const last = this.samples[this.samples.length - 1] || null;
    const first = this.samples[0] || null;
    const smoothed = median(recentValues);
    const min = allValues.length ? Math.min(...allValues) : null;
    const max = allValues.length ? Math.max(...allValues) : null;
    const span = max !== null && min !== null ? max - min : 0;

    const churnCutoff = time - this.options.churnWindowMs;
    this.churnEvents = this.churnEvents.filter(
      (event) => event.recoveredAt >= churnCutoff
    );
    const lastEvent = this.lastChurn;
    const recentChurnEvents = this.churnEvents.length;
    const averageDrop = this.totalChurnEvents
      ? Math.round(this.totalDropSum / this.totalChurnEvents)
      : 0;

    let pendingDrop = null;
    if (
      this.dropState &&
      time - this.dropState.at > this.options.recoveryWindowMs
    ) {
      this._closeDrop('unrecovered', this.dropState.at + this.options.recoveryWindowMs);
    }
    if (this.dropState) {
      pendingDrop = {
        from: this.dropState.from,
        low: this.dropState.low,
        drop: this.dropState.from - this.dropState.low,
        ageMs: Math.max(0, time - this.dropState.at),
        fromTs: this.dropState.fromTs,
        erBefore: this.dropState.erBefore,
      };
    }

    return {
      samples: this.samples.length,
      current: last ? last.value : null,
      firstTs: first ? first.ts : null,
      lastTs: last ? last.ts : null,
      median: smoothed,
      min,
      max,
      span,
      volatility: smoothed ? span / smoothed : 0,
      // `churnEvents` stays the recent-window count (15 min) for the compact
      // "за последние 15 минут" row; `totalChurnEvents` is the whole session.
      churnEvents: recentChurnEvents,
      churnRecent: recentChurnEvents,
      totalChurnEvents: this.totalChurnEvents,
      churnActive: recentChurnEvents >= this.options.churnEventsForAlert,
      totalSurges: this.totalSurges,
      totalOutflows: this.totalOutflows,
      lastOutflow: this.lastOutflow && { ...this.lastOutflow },
      lastSurge: this.lastSurge,
      averageSurge: this.totalSurges ? Math.round(this.surgeSum / this.totalSurges) : 0,
      lastAnomaly: this.lastAnomaly,
      averageDrop,
      maxDrop: this.totalMaxDrop,
      totalMaxDrop: this.totalMaxDrop,
      lastEvent,
      pendingDrop,
    };
  }

  _trim(now: number) {
    const cutoff = Math.min(now - this.options.retainMs, this.retentionStart);
    while (this.samples[0] && this.samples[0].ts < cutoff) {
      this.samples.shift();
    }
    while (this.samples.length > this.options.maxSamples && this.samples[0]!.ts < this.retentionStart) {
      this.samples.shift();
    }
    const churnCutoff = now - this.options.churnWindowMs - 1000;
    while (this.churnEvents[0] && this.churnEvents[0].recoveredAt < churnCutoff) {
      this.churnEvents.shift();
    }
  }

  _detectChurn(value: number, now: number, cleanUsers: number | null) {
    const dropWindowMs = this.options.surgeWindowMs;

    if (this.dropState && now - this.dropState.at > this.options.recoveryWindowMs) {
      this._closeDrop('unrecovered', this.dropState.at + this.options.recoveryWindowMs);
    }
    let peakValue = 0;
    let peakTs = null;
    let peakClean = null;
    const cutoff = Math.max(now - dropWindowMs, this.dropBaselineAt);
    for (let i = this.anchors.length - 1; i >= 0; i -= 1) {
      const sample = this.anchors[i];
      if (!sample) continue;
      if (sample.ts < cutoff) {
        break;
      }
      if (sample.ts < now && sample.value > peakValue) {
        peakValue = sample.value;
        peakTs = sample.ts;
        peakClean = sample.clean;
      }
    }

    const threshold = movementThreshold(peakValue, value);

    if (!this.dropState) {
      if (
        peakTs !== null &&
        peakTs < now &&
        peakValue - value >= threshold
      ) {
        this.dropState = {
          from: peakValue,
          fromTs: peakTs,
          at: now,
          low: value,
          lowTs: now,
          lowClean: cleanUsers,
          erBefore: erPercent(peakClean, peakValue),
        };
      }
      return;
    }

    const state = this.dropState;
    if (value < state.low) {
      state.low = value;
      state.lowTs = now;
      state.lowClean = cleanUsers;
    }

    const stillBelow = state.from - value >= movementThreshold(state.from, value);
    let outflow;
    if (!state.event && !stillBelow) {
      this.dropState = null;
      return;
    }
    if (!state.event && stillBelow && now - state.at >= this.options.dropConfirmMs) {
      outflow = state.event = {
        kind: 'viewer-outflow', ts: state.at, from: state.from,
        startedAt: state.at, raid: this.raids.filter(raid => raid.ts <= now && now - raid.ts <= 180000).at(-1) ?? null,
        fromTs: state.fromTs, confirmedAt: now, status: 'observing',
      };
      this.lastOutflow = outflow;
      this.totalOutflows += 1;
    }
    if (state.event) {
      Object.assign(state.event, {
        to: state.low, lowTs: state.lowTs, delta: state.low - state.from,
      });
    }

    if (state.event && !stillBelow && value >= state.from * (1 - this.options.recoveryRatio)) {
      if (now - state.at < this.options.dropConfirmMs) {
        this._closeDrop('unrecovered', now);
        return;
      }
      const event = {
        from: state.from,
        low: state.low,
        drop: state.from - state.low,
        startedAt: state.at,
        recoveredAt: now,
        durationMs: now - state.at,
        erBefore: state.erBefore,
        erAtLow: erPercent(state.lowClean, state.low),
        erAfter: erPercent(cleanUsers, value),
      };
      this.churnEvents.push(event);
      this.lastChurn = event;
      this.lastAnomaly = {
        kind: 'churn', ts: now, from: event.from, to: event.low,
        delta: -event.drop, durationMs: event.durationMs,
        fromTs: state.fromTs, lowTs: state.lowTs,
      };
      this.totalChurnEvents += 1;
      this.totalDropSum += event.drop;
      this.totalMaxDrop = Math.max(this.totalMaxDrop, event.drop);
      this.pendingRise = null;
      this.anchors = [];
      this._closeDrop('recovered', now);
    }
    return outflow;
  }

  _closeDrop(status: 'unrecovered' | 'recovered' | 'interrupted', now: number) {
    const event = this.dropState?.event;
    if (event) {
      event.status = status;
      event.closedAt = now;
      if (status === 'recovered') event.recoveredAt = now;
    }
    this.dropBaselineAt = now;
    this.dropState = null;
  }

  interrupt(now = this.samples.at(-1)?.ts ?? Date.now()) {
    this.samples = [];
    this.anchors = [];
    this.pendingRise = null;
    this.lastSurgeAt = -Infinity;
    this._closeDrop('interrupted', now);
  }

  recordRaid(raid: Raid) {
    this.raids = this.raids.filter((event) => event.ts >= raid.ts - this.options.retainMs);
    if (this.raids.some((event) => event.id === raid.id)) {
      return false;
    }
    this.raids.push(raid);
    return true;
  }

  _detectSurge(sample: ViewerSample, countMessages?: (from: number, to: number) => number | null) {
    const { surgeWindowMs } = this.options;
    if (sample.ts - this.lastSurgeAt <= surgeWindowMs && this.lastSurge) {
      if (sample.value > this.lastSurge.to) {
        this.lastSurgeAt = sample.ts;
        this.surgeSum += sample.value - this.lastSurge.to;
        Object.assign(this.lastSurge, { to: sample.value, delta: sample.value - this.lastSurge.from, peakTs: sample.ts });
      }
      return;
    }
    if (this.pendingRise && sample.value - this.pendingRise.from.value <
        movementThreshold(this.pendingRise.from.value, sample.value)) this.pendingRise = null;
    if (!this.pendingRise) {
      const from = this.anchors.reduce((low, point) => point.ts < sample.ts && point.value <= low.value ? point : low, sample);
      if (sample.value - from.value < movementThreshold(from.value, sample.value)) return;
      this.pendingRise = { from, at: sample.ts, peak: sample };
      return;
    }
    if (sample.value > this.pendingRise.peak.value) this.pendingRise.peak = sample;
    const { from, at, peak: highest } = this.pendingRise;
    if (sample.ts - at < this.options.dropConfirmMs) return;
    this.pendingRise = null;
    const delta = highest.value - from.value;
    const durationMs = sample.ts - from.ts;
    const before = countMessages?.(from.ts - surgeWindowMs, from.ts);
    const during = countMessages?.(from.ts, sample.ts);
    const beforeRate = typeof before === 'number' && Number.isFinite(before) ? before * 60000 / surgeWindowMs : null;
    const duringRate = typeof during === 'number' && Number.isFinite(during) ? during * 60000 / durationMs : null;
    const raid = this.raids.reduce<Raid | null>((nearest, event) =>
      event.ts <= sample.ts && sample.ts - event.ts <= 180000 &&
        (!nearest || event.ts > nearest.ts) ? event : nearest, null);
    const peak = this.samples.reduce<ViewerSample | null>((highest, previous) =>
      previous.ts < from.ts && previous.ts >= from.ts - this.options.recoveryWindowMs &&
      (!highest || previous.value > highest.value) ? previous : highest, null);
    const precedingDrop = peak && peak.value - from.value >=
      movementThreshold(peak.value, from.value)
      ? { from: peak.value, to: from.value, fromTs: peak.ts, ts: from.ts }
      : null;
    this.lastSurgeAt = sample.ts;
    this.totalSurges += 1;
    this.surgeSum += delta;
    this.lastAnomaly = this.lastSurge = {
      kind: 'surge', ts: sample.ts, startedAt: at, confirmedAt: sample.ts, peakTs: highest.ts, from: from.value, to: highest.value,
      delta, durationMs, fromTs: from.ts, beforeRate, duringRate,
      rateRatio: beforeRate !== null && beforeRate > 0 && duringRate !== null ? duringRate / beforeRate : null,
      raid, precedingDrop,
    };
  }
}
