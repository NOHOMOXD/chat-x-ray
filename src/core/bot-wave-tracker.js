/*
 * Twitch Chat X-Ray — bot-wave detector.
 * Tracks badged/unbadged message counts in 20-second buckets and raises a
 * wave flag when the unbadged branch spikes (Z > 3.0) while the badged core
 * does not react (Z < 1.5).
 */
import { zScore } from './text-analysis.js';

export const DEFAULTS = Object.freeze({
  bucketMs: 20000,
  bucketCount: 30,
  waveZ: 3.0,
  badgedWaveZ: 1.5,
  minWaveBucketMessages: 3,
  minWaveHistoryBuckets: 6,
  minWaveHistoryMessages: 0,
});

export class BotWaveTracker {
  constructor(options) {
    this.options = Object.assign({}, DEFAULTS, options || {});
    this.reset();
  }

  reset() {
    this.buckets = new Map();
    this.currentWave = false;
    this.currentWaveBucket = null;
    this.firstBucketStart = null;
  }

  get isBotWave() {
    return this.currentWave;
  }

  observe(record) {
    const bucketStart = record.bucketStart;

    if (this.firstBucketStart === null || bucketStart < this.firstBucketStart) {
      this.firstBucketStart = bucketStart;
    }

    if (
      this.currentWaveBucket !== null &&
      this.currentWaveBucket !== bucketStart
    ) {
      this.currentWave = false;
      this.currentWaveBucket = null;
    }

    const bucket = this._getBucket(bucketStart);
    bucket.records.push(record);
    if (record.unbadged) {
      bucket.unbadged += 1;
    } else {
      bucket.badged += 1;
    }

    let waveTriggered = false;
    if (!bucket.wave && this._isWaveAt(bucketStart)) {
      bucket.wave = true;
      this.currentWave = true;
      this.currentWaveBucket = bucketStart;
      waveTriggered = true;
    }

    return {
      bucket: bucket,
      waveTriggered: waveTriggered,
      wave: bucket.wave,
    };
  }

  isWaveActive(now) {
    const currentTime = Number.isFinite(now) ? now : Date.now();
    const bucketStart =
      Math.floor(currentTime / this.options.bucketMs) * this.options.bucketMs;
    const bucket = this.buckets.get(bucketStart);
    return Boolean(bucket && bucket.wave);
  }

  getActiveWaveBucket(now) {
    const currentTime = Number.isFinite(now) ? now : Date.now();
    const bucketStart =
      Math.floor(currentTime / this.options.bucketMs) * this.options.bucketMs;
    const bucket = this.buckets.get(bucketStart);
    return bucket && bucket.wave ? bucketStart : null;
  }

  prune(now) {
    const cutoff =
      now -
      this.options.bucketMs * this.options.bucketCount -
      this.options.bucketMs;
    this.buckets.forEach((bucket, start) => {
      if (start < cutoff) {
        this.buckets.delete(start);
      }
    });
  }

  _getBucket(bucketStart) {
    let bucket = this.buckets.get(bucketStart);
    if (!bucket) {
      bucket = {
        start: bucketStart,
        badged: 0,
        unbadged: 0,
        wave: false,
        records: [],
      };
      this.buckets.set(bucketStart, bucket);
    }
    return bucket;
  }

  _isWaveAt(bucketStart) {
    const current = this.buckets.get(bucketStart);
    if (!current || current.unbadged < this.options.minWaveBucketMessages) {
      return false;
    }
    if (this.firstBucketStart === null) {
      return false;
    }

    const earliest = Math.max(
      this.firstBucketStart,
      bucketStart - this.options.bucketMs * this.options.bucketCount
    );
    const unbadgedHistory = [];
    const badgedHistory = [];
    let historyTotal = 0;
    let observedBuckets = 0;

    for (
      let start = earliest;
      start < bucketStart;
      start += this.options.bucketMs
    ) {
      const bucket = this.buckets.get(start);
      const unbadgedCount = bucket ? bucket.unbadged : 0;
      unbadgedHistory.push(unbadgedCount);
      badgedHistory.push(bucket ? bucket.badged : 0);
      historyTotal += unbadgedCount;
      observedBuckets += 1;
    }

    if (observedBuckets < this.options.minWaveHistoryBuckets) {
      return false;
    }
    if (historyTotal < this.options.minWaveHistoryMessages) {
      return false;
    }

    const unbadgedZ = zScore(current.unbadged, unbadgedHistory);
    const badgedZ = zScore(current.badged, badgedHistory);

    return unbadgedZ > this.options.waveZ && badgedZ < this.options.badgedWaveZ;
  }
}
