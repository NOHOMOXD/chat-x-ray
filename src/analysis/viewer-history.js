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
  retainMs: 15 * 60 * 1000,
  medianWindowMs: 10 * 60 * 1000,
  maxSamples: 400,
  minSampleIntervalMs: 3000,
  // A drop must be at least this large in relative or absolute terms.
  dropMinRatio: 0.04,
  dropMinAbs: 300,
  // The peak a drop is measured from must be recent (bots churn fast).
  dropWindowMs: 3 * 60 * 1000,
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

export function erPercent(cleanUsers, viewers) {
  if (
    !Number.isFinite(cleanUsers) ||
    cleanUsers < 0 ||
    !Number.isFinite(viewers) ||
    viewers <= 0
  ) {
    return null;
  }
  return Math.round((cleanUsers / viewers) * 10000) / 100;
}

export function median(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >>> 1;
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export class ViewerHistory {
  constructor(options) {
    this.options = Object.assign({}, VIEWER_HISTORY_DEFAULTS, options || {});
    this.reset();
  }

  reset() {
    this.samples = [];
    this.churnEvents = [];
    this.dropState = null;
    this.startedAt = null;
    // Session totals are deliberately not pruned by the 15-minute recent
    // window: the user wants the whole stream's rollback count, not a count
    // that silently drops from 5 to 1 as events age out.
    this.totalChurnEvents = 0;
    this.totalDropSum = 0;
    this.totalMaxDrop = 0;
    this.dropSamples = [];
  }

  /**
   * Feed one parsed official viewer count. Samples are coalesced while the
   * number is unchanged, so a 15-minute history stays small.
   */
  record(value, now, meta) {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    const time = Number.isFinite(now) ? now : Date.now();
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
      meta && Number.isFinite(meta.cleanUsers) && meta.cleanUsers >= 0
        ? meta.cleanUsers
        : null;
    this.samples.push({ ts: time, value, clean: cleanUsers });

    this._trim(time);
    this._detectChurn(value, time, cleanUsers);
  }

  getStats(now) {
    const time = Number.isFinite(now) ? now : Date.now();
    this._trim(time);

    const medianCutoff = time - this.options.medianWindowMs;
    const recentValues = [];
    const allValues = [];
    for (let i = 0; i < this.samples.length; i += 1) {
      const sample = this.samples[i];
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
    const lastEvent = this.churnEvents.length
      ? this.churnEvents[this.churnEvents.length - 1]
      : null;
    const recentChurnEvents = this.churnEvents.length;
    const averageDrop = this.totalChurnEvents
      ? Math.round(this.totalDropSum / this.totalChurnEvents)
      : 0;

    let pendingDrop = null;
    if (
      this.dropState &&
      time - this.dropState.at > this.options.recoveryWindowMs
    ) {
      // The window to see a refill elapsed without one; stop advertising a
      // pending rollback.
      this.dropState = null;
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
      churnActive:
        this.totalChurnEvents >= this.options.churnEventsForAlert,
      averageDrop,
      maxDrop: this.totalMaxDrop,
      totalMaxDrop: this.totalMaxDrop,
      dropSamples: this.dropSamples.slice(),
      lastEvent,
      pendingDrop,
    };
  }

  _trim(now) {
    const cutoff = now - this.options.retainMs;
    while (this.samples.length && this.samples[0].ts < cutoff) {
      this.samples.shift();
    }
    while (this.samples.length > this.options.maxSamples) {
      this.samples.shift();
    }
    const churnCutoff = now - this.options.churnWindowMs - 1000;
    while (this.churnEvents.length && this.churnEvents[0].recoveredAt < churnCutoff) {
      this.churnEvents.shift();
    }
  }

  _detectChurn(value, now, cleanUsers) {
    const { dropWindowMs, dropMinRatio, dropMinAbs } = this.options;

    let peakValue = 0;
    let peakTs = null;
    let peakClean = null;
    for (let i = this.samples.length - 1; i >= 0; i -= 1) {
      const sample = this.samples[i];
      if (sample.ts < now - dropWindowMs) {
        break;
      }
      if (sample.value > peakValue) {
        peakValue = sample.value;
        peakTs = sample.ts;
        peakClean = sample.clean;
      }
    }

    const threshold = Math.max(dropMinAbs, peakValue * dropMinRatio);

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
    if (value <= state.low) {
      state.low = value;
      state.lowTs = now;
      state.lowClean = cleanUsers;
    }

    if (value >= state.from * (1 - this.options.recoveryRatio)) {
      // Ignore a single bad sample: a real bot rollback lasts, a CDN/UI
      // glitch does not.
      if (now - state.at < this.options.dropConfirmMs) {
        this.dropState = null;
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
      this.totalChurnEvents += 1;
      this.totalDropSum += event.drop;
      this.totalMaxDrop = Math.max(this.totalMaxDrop, event.drop);
      this.dropSamples.push(event.drop);
      if (this.dropSamples.length > 12) {
        this.dropSamples.shift();
      }
      this.dropState = null;
      return;
    }

    if (now - state.at > this.options.recoveryWindowMs) {
      // The audience really got smaller (purge without a refill); not a churn
      // cycle. Forget the pending drop and let a new peak form.
      this.dropState = null;
    }
  }
}
