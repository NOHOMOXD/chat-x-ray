/*
 * Twitch Chat X-Ray — unique-account user-id cluster index.
 *
 * Bot farms register accounts in batches, so their numeric Twitch user ids sit
 * close together. The analyzer needs "how many other unbadged accounts showed
 * up within ±50 000 ids during the observation window?" for every message.
 *
 * Scanning the 300-message window for that is O(n) per message and only sees a
 * few seconds of a busy chat. This index keeps every unbadged account seen in
 * the session window in a sorted array, so a peer count is two binary searches.
 */
export const DEFAULT_CLUSTER_RADIUS = 50000;
export const DEFAULT_INDEX_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_IDS = 50000;
export const DEFAULT_PRUNE_INTERVAL_MS = 30 * 1000;

function lowerBound(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function upperBound(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export class IdClusterIndex {
  constructor(options) {
    this.options = Object.assign(
      {
        radius: DEFAULT_CLUSTER_RADIUS,
        ttlMs: DEFAULT_INDEX_TTL_MS,
        maxIds: DEFAULT_MAX_IDS,
        pruneIntervalMs: DEFAULT_PRUNE_INTERVAL_MS,
      },
      options || {}
    );
    this.reset();
  }

  reset() {
    this.byId = new Map();
    this.sorted = [];
    this._lastPrune = 0;
  }

  get size() {
    return this.byId.size;
  }

  /**
   * Register an account. Repeated messages only refresh its timestamp; the
   * cluster count is per unique account, not per message.
   */
  add(numericId, ts) {
    if (!Number.isSafeInteger(numericId) || numericId < 0) {
      return false;
    }
    const time = Number.isFinite(ts) ? ts : Date.now();
    const previous = this.byId.get(numericId);
    if (previous !== undefined) {
      if (time > previous) {
        this.byId.set(numericId, time);
      }
      return false;
    }

    const at = lowerBound(this.sorted, numericId);
    this.sorted.splice(at, 0, numericId);
    this.byId.set(numericId, time);

    if (this.byId.size > this.options.maxIds) {
      this._evictOldest(this.byId.size - this.options.maxIds);
    }
    return true;
  }

  /**
   * Number of *other* unique accounts whose id is closer than `radius`.
   * Ids are integers, so the strict `|a - b| < radius` comparison becomes
   * an inclusive integer range [id - radius + 1, id + radius - 1].
   */
  countPeers(numericId, radius) {
    if (!Number.isSafeInteger(numericId) || !this.sorted.length) {
      return 0;
    }
    const distance =
      Number.isSafeInteger(radius) && radius > 0 ? radius : this.options.radius;
    const low = lowerBound(this.sorted, numericId - distance + 1);
    const high = upperBound(this.sorted, numericId + distance - 1);
    let count = high - low;
    if (this.byId.has(numericId)) {
      count -= 1;
    }
    return Math.max(0, count);
  }

  /**
   * Drop accounts that have been silent longer than the rolling session
   * window. The rebuild is throttled: in a 50 000-message stream a full sweep
   * on every message would be pointless.
   */
  prune(now) {
    const time = Number.isFinite(now) ? now : Date.now();
    if (
      this._lastPrune &&
      time - this._lastPrune < this.options.pruneIntervalMs &&
      this.byId.size <= this.options.maxIds
    ) {
      return 0;
    }
    this._lastPrune = time;

    const cutoff = time - this.options.ttlMs;
    let removed = 0;
    this.byId.forEach((lastTs, id) => {
      if (lastTs < cutoff) {
        this.byId.delete(id);
        removed += 1;
      }
    });

    if (removed > 0) {
      this._rebuildSorted();
    }
    return removed;
  }

  _evictOldest(count) {
    if (count <= 0) {
      return;
    }
    const entries = Array.from(this.byId.entries());
    entries.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < count && i < entries.length; i += 1) {
      this.byId.delete(entries[i][0]);
    }
    this._rebuildSorted();
  }

  _rebuildSorted() {
    this.sorted = Array.from(this.byId.keys());
    this.sorted.sort((a, b) => a - b);
  }
}
