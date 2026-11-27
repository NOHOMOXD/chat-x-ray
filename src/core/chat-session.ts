/*
 * Twitch Chat X-Ray — session state.
 * Deduplication of IRC message IDs, per-user history for rhythm/self-repeat
 * and active chatter statistics.
 */
export interface SuspicionRecord {
  botScore?: number | undefined;
  triggers?: Array<{ key: string }>;
  roleExempt?: boolean;
  serviceBot?: boolean;
  botConfirmation?: unknown;
}

export interface ChatRecord extends SuspicionRecord {
  id: string;
  ts: number;
  receivedAt?: number | undefined;
  sequence?: number;
  userKey: string;
  freshAccount?: boolean;
  command?: string | null | undefined;
}

interface UserState {
  userKey: string;
  login: string;
  displayName: string;
  count: number;
  firstTs: number;
  lastTs: number;
  recentNorm: string[];
  recentTs: number[];
}

interface SessionOptions {
  recentWindowMs: number;
  selfHistorySize: number;
  maxUsers: number;
  userTtlMs: number;
  suspiciousThreshold?: number;
}

export const BEHAVIOR_TRIGGERS = new Set(['self-repeat', 'mechanical-rhythm', 'solicitation', 'group-recurrence', 'wave-order', 'wave-phrase']);

export function hasSuspiciousBehavior(record: SuspicionRecord) {
  return !record.roleExempt && !record.serviceBot &&
    record.triggers?.some(trigger => BEHAVIOR_TRIGGERS.has(trigger.key)) === true;
}

export function isSuspicious(record: SuspicionRecord, threshold: number) {
  return !!record.botConfirmation || (Number(record.botScore) >= threshold && hasSuspiciousBehavior(record));
}

export const DEFAULTS = Object.freeze({
  recentWindowMs: 10 * 60 * 1000,
  selfHistorySize: 5,
  maxUsers: 20000,
  userTtlMs: 6 * 60 * 60 * 1000,
});

export class ChatSession<RecordType extends ChatRecord = ChatRecord> {
  readonly options: SessionOptions;
  users = new Map<string, UserState>();
  records: RecordType[] = [];
  private seenIds = new Map<string, number>();
  private seenQueue: Array<{ id: string; ts: number }> = [];
  private _lastUserPrune = 0;

  constructor(options?: Partial<SessionOptions>) {
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

  markSeen(id: string, now: number) {
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

  getUserState(userKey: string, login: string, displayName: string, ts: number) {
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

  commit(record: RecordType, normalized: string) {
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

  prune(now: number) {
    const cutoff = now - this.options.recentWindowMs;

    let expiredRecords = 0;
    while ((this.records[expiredRecords]?.ts ?? Infinity) < cutoff) {
      expiredRecords += 1;
    }
    if (expiredRecords) this.records.splice(0, expiredRecords);

    let expiredIds = 0;
    while ((this.seenQueue[expiredIds]?.ts ?? Infinity) < cutoff) {
      const entry = this.seenQueue[expiredIds];
      if (entry && this.seenIds.get(entry.id) === entry.ts) {
        this.seenIds.delete(entry.id);
      }
      expiredIds += 1;
    }
    if (expiredIds) this.seenQueue.splice(0, expiredIds);

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
          const user = users[i];
          if (user) this.users.delete(user[0]);
        }
      }
    }
  }

  getStats(now: number, since = -Infinity, afterSequence = 0) {
    this.prune(now);

    return calculateChatStats(this.records, this.options, now, since, afterSequence, this.users.size);
  }
}

// Calculate the same rolling window for live and restored records.
export function calculateChatStats(records: ChatRecord[], options: SessionOptions, now: number, since = -Infinity, afterSequence = 0, sessionUsers = 0) {
  const activeUsers = new Set();
  const scoredUsers = new Set();
  const suspiciousUsers = new Set();
  const serviceBots = new Set();
  const minuteUsers = new Set();
  const authorMessages = new Map<string, number>();
  let topAuthorMessages = 0;
  const commands = new Map<string, { count: number; authors: Set<string> }>();
  let audienceMessages = 0;
  let windowMessages = 0;
  const freshUsers = new Set();
  let minuteMessages = 0;
  let suspiciousMessages = 0;
  // The analyzer injects its threshold through the constructor; that value
  // is the single source of truth here.
  const threshold = options.suspiciousThreshold ?? NaN;

  for (const record of records) {
    // The socket boundary is local, while Twitch timestamps can precede it.
    if (Number(record.sequence) <= afterSequence || record.ts > now || record.ts < now - options.recentWindowMs ||
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
      const command = record.command;
      if (command) {
        const group = commands.get(command) ?? { count: 0, authors: new Set() };
        group.count++;
        group.authors.add(record.userKey);
        commands.set(command, group);
      }
      const count = (authorMessages.get(record.userKey) ?? 0) + 1;
      authorMessages.set(record.userKey, count);
      topAuthorMessages = Math.max(topAuthorMessages, count);
    }
    if (record.freshAccount) {
      freshUsers.add(record.userKey);
    }
    if (record.botConfirmation || Number(record.botScore) >= threshold) scoredUsers.add(record.userKey);
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
    massCommand: [...commands.values()].some(group => group.count * 2 >= audienceMessages &&
      group.authors.size >= 20 && group.authors.size * 2 >= authorMessages.size),
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
    sessionUsers,
  };
}
