import { tokenJaccard, normalizedLevenshtein, round } from './text-analysis.ts';

interface R9KOptions {
  r9kMaxExactEntries: number;
  r9kMaxWindowMs: number;
  r9kMinLength: number;
  r9kShortThreshold: number;
  r9kThreshold: number;
  r9kMaxHistoryMessages: number;
}

interface RecentMessage {
  id: string;
  ts: number;
  normalized: string;
  userKey: string;
}

type ExactMatch = Pick<RecentMessage, 'id' | 'ts' | 'userKey'>;

// Maintains exact matches and searches the recent window for similar messages.
export class R9KMatcher {
  private readonly exact = new Map<string, ExactMatch>();
  private lastPrune = 0;

  constructor(private readonly options: R9KOptions) {}

  reset() {
    this.exact.clear();
    this.lastPrune = 0;
  }

  remember(normalized: string, ts: number, record: Pick<RecentMessage, 'id' | 'userKey'>) {
    if (normalized.length >= this.options.r9kMinLength) {
      this.exact.set(normalized, { ts, id: record.id, userKey: record.userKey });
    }
  }

  prune(now: number) {
    const max = this.options.r9kMaxExactEntries;
    if (
      this.lastPrune &&
      now - this.lastPrune < 30000 &&
      this.exact.size <= max
    ) {
      return;
    }
    this.lastPrune = now;

    const cutoff = now - this.options.r9kMaxWindowMs;
    this.exact.forEach((entry, key) => {
      if (entry.ts < cutoff) {
        this.exact.delete(key);
      }
    });

    if (this.exact.size > max) {
      const entries = Array.from(this.exact.entries());
      entries.sort((a, b) => a[1].ts - b[1].ts);
      const excess = this.exact.size - max;
      for (let i = 0; i < excess; i += 1) {
        const entry = entries[i];
        if (entry) this.exact.delete(entry[0]);
      }
    }
  }

  /**
   * R9K duplicate search.
   *
   * Exact normalized matches are kept in a 15-minute hash map, so a spam
   * message repeated 5 minutes later is still caught even in a 500 msg/min
   * chat (the old 150-message scan covered only ~18 seconds there). The tail
   * window adds fuzzy matching for near-duplicates and short messages.
   */
  find(normalized: string, ts: number, window: RecentMessage[]) {
    const minLength = this.options.r9kMinLength;
    if (!normalized || normalized.length < minLength) {
      return null;
    }

    const maxWindowMs = this.options.r9kMaxWindowMs;
    const exact = this.exact.get(normalized);
    if (exact) {
      if (exact.ts <= ts && ts - exact.ts <= maxWindowMs) {
        return {
          record: { id: exact.id },
          similarity: 1,
          exact: true,
        };
      }
      if (exact.ts > ts || ts - exact.ts > maxWindowMs) {
        this.exact.delete(normalized);
      }
    }

    const shortMessage = normalized.length <= 8;
    const threshold = shortMessage
      ? this.options.r9kShortThreshold
      : this.options.r9kThreshold;
    const maxMessages = this.options.r9kMaxHistoryMessages;
    const earliest = ts - maxWindowMs;

    let checkedCount = 0;
    for (let i = window.length - 1; i >= 0; i -= 1) {
      const previous = window[i];
      if (!previous) continue;
      if (previous.ts < earliest || checkedCount >= maxMessages) {
        break;
      }
      checkedCount += 1;

      if (!previous.normalized || previous.normalized.length < minLength) {
        continue;
      }

      let similarity = tokenJaccard(normalized, previous.normalized);
      if (similarity < threshold) {
        const maxLength = Math.max(normalized.length, previous.normalized.length);
        const minTextLength = Math.min(
          normalized.length,
          previous.normalized.length
        );
        // Short messages need the edit-distance check without the length-ratio
        // gate: "rofl" vs "rofls" is 0.8, while the old gate rejected it.
        if (shortMessage || minTextLength / maxLength >= threshold) {
          similarity = Math.max(
            similarity,
            normalizedLevenshtein(normalized, previous.normalized)
          );
        }
      }

      if (similarity >= threshold) {
        return {
          record: previous,
          similarity: round(similarity, 3),
        };
      }
    }

    return null;
  }

}
