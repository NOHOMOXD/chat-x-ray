/*
 * Twitch Chat X-Ray — per-channel engagement-rate baseline.
 *
 * ER (clean chatters / official viewers) is the most useful public signal we
 * have, but the absolute number depends on the streamer, the game and the
 * threshold slider. Comparing a channel to itself is much more informative:
 * "2.3% now, usually 4.8% on this channel" flags an anomaly without pretending
 * to know the one true viewer count.
 *
 * The baseline is local-only. It is kept per channel AND per action threshold,
 * because changing the threshold reclassifies borderline accounts and would
 * otherwise make historical ER values incomparable. Only the last few sessions
 * are kept; one bot-swarmed evening must not become the new normal.
 */
import { callStorage, getStorageArea } from '../platform/browser-api.js';

export const ER_BASELINE_KEY = 'tcx:erBaseline:v1';

export const ER_BASELINE_DEFAULTS = Object.freeze({
  maxSessions: 5,
  minSamples: 4,
  minSessionMs: 5 * 60 * 1000,
  minOfficialViewers: 100,
  minCleanUsers: 3,
  sampleIntervalMs: 30000,
});

export function baselineKey(channel, threshold) {
  return `${String(channel || '').toLowerCase()}|${Number(threshold) || 0}`;
}

export function medianNumber(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >>> 1;
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundEr(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Tiny chrome.storage.local-backed map. Storage is injected so the module can
 * be unit-tested in Node; without a storage area it still works in memory.
 */
export class ErBaselineStore {
  constructor(options) {
    const settings = options || {};
    this.storage =
      settings.storage === undefined
        ? getStorageArea()
        : settings.storage || null;
    this.storageKey = settings.storageKey || ER_BASELINE_KEY;
    this.maxSessions =
      Number(settings.maxSessions) || ER_BASELINE_DEFAULTS.maxSessions;
    this.data = {};
    this.ready = false;
    this.loading = null;
    this.persistTimer = null;
  }

  load() {
    if (this.loading) {
      return this.loading;
    }
    if (!this.storage || typeof this.storage.get !== 'function') {
      this.ready = true;
      this.loading = Promise.resolve();
      return this.loading;
    }

    this.loading = callStorage(
      this.storage.get.bind(this.storage),
      this.storageKey
    )
      .then((result) => {
        const data = result && result[this.storageKey];
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          this.data = data;
        }
      })
      .catch(() => {
        // Storage failures must never break the live estimate.
        this.data = {};
      })
      .finally(() => {
        this.ready = true;
      });
    return this.loading;
  }

  get(channel, threshold) {
    const entry = this.data[baselineKey(channel, threshold)];
    if (!entry || !Array.isArray(entry.samples) || !entry.samples.length) {
      return null;
    }
    const samples = entry.samples.filter((value) => Number.isFinite(value));
    if (!samples.length) {
      return null;
    }
    return {
      er: roundEr(medianNumber(samples)),
      sessions: samples.length,
      threshold: Number(threshold) || 0,
    };
  }

  record(channel, threshold, er, now) {
    if (!channel || !Number.isFinite(er) || er < 0) {
      return;
    }
    const key = baselineKey(channel, threshold);
    const entry = this.data[key] || { samples: [] };
    entry.samples = Array.isArray(entry.samples) ? entry.samples : [];
    entry.samples.push(roundEr(er));
    if (entry.samples.length > this.maxSessions) {
      entry.samples.shift();
    }
    entry.updatedAt = Number.isFinite(now) ? now : Date.now();
    this.data[key] = entry;
    this._schedulePersist();
  }

  _schedulePersist() {
    if (!this.storage || typeof this.storage.set !== 'function') {
      return;
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flush();
    }, 1000);
  }

  async flush() {
    if (!this.storage || typeof this.storage.set !== 'function') {
      return;
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await callStorage(this.storage.set.bind(this.storage), {
      [this.storageKey]: this.data,
    }).catch(() => {
      // Baseline persistence is best-effort.
    });
  }
}

/**
 * Collects ER samples for the current channel session and, on finish, writes
 * the session median into the store. `previous` is the baseline that existed
 * before this session, so the UI never compares a session with itself.
 */
export class ErSessionTracker {
  constructor(options) {
    const settings = options || {};
    this.channel = String(settings.channel || '').toLowerCase();
    this.threshold = Number(settings.threshold) || 0;
    this.store = settings.store || null;
    this.options = Object.assign({}, ER_BASELINE_DEFAULTS, settings.options || {});
    this.samples = [];
    this.lastSampleAt = 0;
    this.finished = false;
    this.baselineResolved = false;
    this.previous = null;
    this.refreshBaseline();
  }

  refreshBaseline() {
    if (this.baselineResolved || !this.store) {
      return;
    }
    if (!this.store.ready) {
      return;
    }
    this.previous = this.store.get(this.channel, this.threshold);
    this.baselineResolved = true;
  }

  getBaseline() {
    this.refreshBaseline();
    return this.previous;
  }

  observe(officialViewers, cleanUsers, sessionMs, now) {
    if (this.finished) {
      return;
    }
    const time = Number.isFinite(now) ? now : Date.now();
    if (!Number.isFinite(officialViewers) || officialViewers < this.options.minOfficialViewers) {
      return;
    }
    if (!Number.isFinite(cleanUsers) || cleanUsers < this.options.minCleanUsers) {
      return;
    }
    if (!Number.isFinite(sessionMs) || sessionMs < this.options.minSessionMs) {
      return;
    }
    if (
      this.lastSampleAt &&
      time - this.lastSampleAt < this.options.sampleIntervalMs
    ) {
      return;
    }
    this.lastSampleAt = time;
    this.samples.push(roundEr((cleanUsers / officialViewers) * 100));
  }

  finish(now) {
    if (this.finished) {
      return null;
    }
    this.finished = true;
    if (this.samples.length < this.options.minSamples) {
      return null;
    }
    const er = roundEr(medianNumber(this.samples));
    if (this.store) {
      this.store.record(
        this.channel,
        this.threshold,
        er,
        Number.isFinite(now) ? now : Date.now()
      );
    }
    return er;
  }
}
