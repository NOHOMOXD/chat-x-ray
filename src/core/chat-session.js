/*
 * Twitch Chat X-Ray — session state.
 * Deduplication of IRC message IDs, per-user history for rhythm/self-repeat
 * and active chatter statistics.
 */
const BEHAVIOR_TRIGGERS = new Set(['self-repeat', 'mechanical-rhythm', 'solicitation']);

export function hasSuspiciousBehavior(record) {
  return !record.roleExempt && !record.serviceBot &&
    record.triggers?.some(trigger => BEHAVIOR_TRIGGERS.has(trigger.key)) === true;
}

export function isSuspicious(record, threshold) {
  return record.botScore >= threshold && hasSuspiciousBehavior(record);
}

export const DEFAULTS = Object.freeze({
  recentWindowMs: 10 * 60 * 1000,
  selfHistorySize: 5,
  maxUsers: 20000,
  userTtlMs: 6 * 60 * 60 * 1000,
});

export class ChatSession {
  constructor(options) {
    this.options = Object.assign({}, DEFAULTS, options || {});
    this.reset();
  }

  reset() {
    this.users = new Map();
    this.records = [];
    this.seenIds = new Map();
    this.seenQueue = [];
    this._lastUserPrune = 0;
  }

  markSeen(id, now) {
    if (!id) {
      return true;
    }
    if (this.seenIds.has(id)) {
      return false;
    }
    this.seenIds.set(id, now);
    this.seenQueue.push({ id, ts: now });
    return true;
  }

  getUserState(userKey, login, displayName, ts) {
    let user = this.users.get(userKey);
    if (!user) {
      user = {
        userKey,
        login,
        displayName,
        count: 0,
        firstTs: ts,
        lastTs: ts,
        recentNorm: [],
        recentTs: [],
      };
      this.users.set(userKey, user);
    } else {
      user.login = login;
      user.displayName = displayName;
      user.firstTs = Math.min(user.firstTs, ts);
      user.lastTs = Math.max(user.lastTs, ts);
    }
    return user;
  }

  commit(record, normalized) {
    const user = this.users.get(record.userKey);
    if (!user) {
      return;
    }

    user.count += 1;
    user.lastTs = Math.max(user.lastTs, record.ts);

    if (normalized) {
      user.recentNorm.push(normalized);
      if (user.recentNorm.length > this.options.selfHistorySize) {
        user.recentNorm.shift();
      }
    }

    user.recentTs.push(record.ts);
    if (user.recentTs.length > 5) {
      user.recentTs.shift();
    }

    this.records.push(record);
  }

  prune(now) {
    const cutoff = now - this.options.recentWindowMs;

    while (this.records.length > 0 && this.records[0].ts < cutoff) {
      this.records.shift();
    }

    while (this.seenQueue.length > 0 && this.seenQueue[0].ts < cutoff) {
      const entry = this.seenQueue.shift();
      if (this.seenIds.get(entry.id) === entry.ts) {
        this.seenIds.delete(entry.id);
      }
    }

    if (
      this.users.size > this.options.maxUsers ||
      now - this._lastUserPrune > 5 * 60 * 1000
    ) {
      this._lastUserPrune = now;
      const userCutoff = now - this.options.userTtlMs;
      this.users.forEach((user, key) => {
        if (user.lastTs < userCutoff) {
          this.users.delete(key);
        }
      });

      if (this.users.size > this.options.maxUsers) {
        const users = Array.from(this.users.entries());
        users.sort((a, b) => a[1].lastTs - b[1].lastTs);
        const excess = this.users.size - this.options.maxUsers;
        for (let i = 0; i < excess; i += 1) {
          this.users.delete(users[i][0]);
        }
      }
    }
  }

  getStats(now, since = -Infinity, afterSequence = 0) {
    this.prune(now);

    const activeUsers = new Set();
    const scoredUsers = new Set();
    const suspiciousUsers = new Set();
    const serviceBots = new Set();
    const minuteUsers = new Set();
    const authorMessages = new Map();
    let topAuthorMessages = 0;
    let audienceMessages = 0;
    let windowMessages = 0;
    const freshUsers = new Set();
    let minuteMessages = 0;
    let suspiciousMessages = 0;
    // The analyzer injects its threshold through the constructor; that value
    // is the single source of truth here.
    const threshold = this.options.suspiciousThreshold;

    for (let i = 0; i < this.records.length; i += 1) {
      const record = this.records[i];
      // The socket boundary is local, while Twitch timestamps can precede it.
      if (record.sequence <= afterSequence || record.ts > now || record.ts < now - this.options.recentWindowMs ||
          (record.receivedAt ?? record.ts) < since) {
        continue;
      }
      if (record.ts > now - 60000) {
        minuteMessages += 1;
        minuteUsers.add(record.userKey);
      }
      windowMessages += 1;
      activeUsers.add(record.userKey);
      if (record.serviceBot) {
        serviceBots.add(record.userKey);
      } else {
        audienceMessages += 1;
        const count = (authorMessages.get(record.userKey) ?? 0) + 1;
        authorMessages.set(record.userKey, count);
        topAuthorMessages = Math.max(topAuthorMessages, count);
      }
      if (record.freshAccount) {
        freshUsers.add(record.userKey);
      }
      if (record.botScore >= threshold) scoredUsers.add(record.userKey);
      if (isSuspicious(record, threshold)) {
        suspiciousMessages += 1;
        suspiciousUsers.add(record.userKey);
      }
    }

    const suspiciousPercent = windowMessages
      ? Math.round((suspiciousMessages / windowMessages) * 100)
      : 0;

    const totalActive = activeUsers.size;
    const totalSuspicious = suspiciousUsers.size;
    const cleanActive = Math.max(0, totalActive - totalSuspicious - serviceBots.size);

    return {
      messagesPerMinute: minuteMessages,
      minuteUsers: minuteUsers.size,
      serviceBots: serviceBots.size,
      audienceMessages,
      topAuthorMessages,
      activeUsers: totalActive,
      cleanUsers: cleanActive,
      neutralUsers: scoredUsers.size - totalSuspicious,
      suspiciousUsers: totalSuspicious,
      freshUsers: freshUsers.size,
      suspiciousPercent,
      // Share of active chatters flagged by the current threshold, 0..1.
      suspiciousShare: totalActive ? totalSuspicious / totalActive : 0,
      suspiciousMessages,
      windowMessages,
      sessionUsers: this.users.size,
    };
  }
}
