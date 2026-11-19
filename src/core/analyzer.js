import { ID_GROUP_RULE, describeGroups, findIdGroups, recordsAt, summarizeMatches } from './id-group-diagnostics.js';
/*
 * Twitch Chat X-Ray — message analyzer.
 * Composes TextAnalysis, ChatSession, BotWaveTracker and BotLogger.
 * Uses a 100-point balanced weight matrix and Chatterino-style adaptive R9K window.
 */
import {
  normalizeText,
  tokenJaccard,
  normalizedLevenshtein,
  round,
  isSterileText,
  isCharacterFlood,
  isSolicitation,
  detectRhythm,
  findSelfSimilarity,
  hasNumericSuffixPattern,
  clamp,
} from './text-analysis.js';
import { BotWaveTracker } from './bot-wave-tracker.js';
import { ChatSession } from './chat-session.js';
import { BotLogger } from '../config/bot-logger.js';
import { IdClusterIndex } from './id-cluster-index.js';

/*
 * 100-point matrix (sum = 100).
 *
 * Rebalanced when `fresh-account` was added: `idCluster` 20 → 15 because the
 * id window grew 10× and the trigger now fires much more often, `botWave`
 * 15 → 10 because it is a bucket-level flag applied on top of account-level
 * evidence, and the old combined `mechanical` 10 was split into rhythm 5 +
 * sterile text 5 so the two keys can be filtered separately in audit dumps.
 */
export const WEIGHTS = Object.freeze({
  noBadges: 15,
  defaultColor: 10,
  usernameDigits: 10,
  firstMessage: 10,
  idCluster: 15,
  freshAccount: 10,
  botWave: 10,
  mechanicalRhythm: 5,
  sterileText: 5,
  selfRepeat: 10,
});

/*
 * Hard content signals applied on top of the 100-point matrix. The matrix
 * describes the account profile; a scam script is direct evidence and must be
 * able to push an otherwise ordinary unbadged account over the action
 * threshold (a classic "dm me, buy me a code" bot scores 35 + 25 = 60).
 */
export const HARD_SIGNAL_WEIGHTS = Object.freeze({
  solicitation: 25,
});

export const DEFAULTS = Object.freeze({
  // The tail window is also the fuzzy R9K scan window. 1 000 messages at
  // ~500 msg/min ≈ 2 minutes; exact duplicates are tracked separately for the
  // full 15-minute R9K window below.
  windowSize: 1000,
  r9kMaxHistoryMessages: 1000,
  r9kMaxWindowMs: 15 * 60 * 1000,
  r9kThreshold: 0.85,
  // Short messages (LOL/ROFL/meow) need their own band: one changed letter
  // would otherwise fall below the long-message Jaccard threshold.
  r9kShortThreshold: 0.75,
  r9kMinLength: 3,
  r9kMaxExactEntries: 20000,
  recentWindowMs: 10 * 60 * 1000,
  bucketMs: 20000,
  bucketCount: 30,
  waveZ: 3.0,
  badgedWaveZ: 1.5,
  suspiciousThreshold: 30,
  selfHistorySize: 5,
  selfJaccardThreshold: 0.65,
  maxUsers: 20000,
  userTtlMs: 6 * 60 * 60 * 1000,
  minWaveBucketMessages: 3,
  minWaveHistoryBuckets: 6,
  minWaveHistoryMessages: 0,
  idClusterRadius: 50000,
  freshAccountAgeDays: 90,
  enableAuditLog: false,
});

// Known service bots produce repeated alerts (subs, timers, commands). They
// are not viewbots and must not be muted by R9K or scored as suspicious.
export const SERVICE_BOT_LOGINS = Object.freeze({
  fossabot: true,
  streamelements: true,
  nightbot: true,
  moobot: true,
  wizebot: true,
  sery_bot: true,
  phantombot: true,
  soundalerts: true,
  streamlabs: true,
  commanderroot: true,
});

export const PRIVILEGED_BADGES = Object.freeze({
  moderator: true,
  broadcaster: true,
  vip: true,
  subscriber: true,
});

export function badgesArray(rawBadges) {
  if (!Array.isArray(rawBadges)) {
    return [];
  }

  const badges = [];
  for (let i = 0; i < rawBadges.length; i += 1) {
    let badge = rawBadges[i];
    if (typeof badge !== 'string') {
      continue;
    }
    badge = badge.toLowerCase();
    if (badge && badges.indexOf(badge) === -1) {
      badges.push(badge);
    }
  }
  return badges;
}

export function parseNumericId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d{1,16}$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }
  return null;
}

export class Analyzer {
  constructor(options) {
    this.options = Object.assign({}, DEFAULTS, options || {});
    this.window = [];
    this.totalMessages = 0;
    this.firstRecordTs = null;
    this.accountAges = new Map();
    this.r9kExact = new Map();
    this._lastR9KPrune = 0;
    this.logger = new BotLogger(200);

    this.session = new ChatSession({
      recentWindowMs: this.options.recentWindowMs,
      suspiciousThreshold: this.options.suspiciousThreshold,
      selfHistorySize: this.options.selfHistorySize,
      maxUsers: this.options.maxUsers,
      userTtlMs: this.options.userTtlMs,
    });

    this.cluster = new IdClusterIndex({
      radius: this.options.idClusterRadius,
      ttlMs: this.options.recentWindowMs,
    });

    this.waveCount = 0;
    this.lastWave = null;
    this.idGroupSnapshot = null;
    this.idGroupsById = new Map();
    this.waves = new BotWaveTracker({
      bucketMs: this.options.bucketMs,
      bucketCount: this.options.bucketCount,
      waveZ: this.options.waveZ,
      badgedWaveZ: this.options.badgedWaveZ,
      minWaveBucketMessages: this.options.minWaveBucketMessages,
      minWaveHistoryBuckets: this.options.minWaveHistoryBuckets,
      minWaveHistoryMessages: this.options.minWaveHistoryMessages,
    });
  }

  reset() {
    this.window = [];
    this.totalMessages = 0;
    this.firstRecordTs = null;
    this.r9kExact.clear();
    this._lastR9KPrune = 0;
    this.session.reset();
    this.cluster.reset();
    this.waves.reset();
    this.waveCount = 0;
    this.lastWave = null;
    this.idGroupSnapshot = null;
    this.idGroupsById = new Map();
    this.logger.clear();
  }

  get isBotWave() {
    return this.waves.isBotWave;
  }

  updateOptions(options) {
    Object.assign(this.options, options || {});
  }

  _prune(now) {
    this.session.prune(now);
    this.cluster.prune(now);
    this.waves.prune(now);
    this._pruneR9KExact(now);
  }

  _pruneR9KExact(now) {
    const max = this.options.r9kMaxExactEntries;
    if (
      this._lastR9KPrune &&
      now - this._lastR9KPrune < 30000 &&
      this.r9kExact.size <= max
    ) {
      return;
    }
    this._lastR9KPrune = now;

    const cutoff = now - this.options.r9kMaxWindowMs;
    this.r9kExact.forEach((entry, key) => {
      if (entry.ts < cutoff) {
        this.r9kExact.delete(key);
      }
    });

    if (this.r9kExact.size > max) {
      const entries = Array.from(this.r9kExact.entries());
      entries.sort((a, b) => a[1].ts - b[1].ts);
      const excess = this.r9kExact.size - max;
      for (let i = 0; i < excess; i += 1) {
        this.r9kExact.delete(entries[i][0]);
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
  _findR9KMatch(normalized, ts) {
    const minLength = this.options.r9kMinLength;
    if (!normalized || normalized.length < minLength) {
      return null;
    }

    const maxWindowMs = this.options.r9kMaxWindowMs;
    const exact = this.r9kExact.get(normalized);
    if (exact) {
      if (exact.ts <= ts && ts - exact.ts <= maxWindowMs) {
        return {
          record: { id: exact.id },
          similarity: 1,
          exact: true,
        };
      }
      if (exact.ts > ts || ts - exact.ts > maxWindowMs) {
        this.r9kExact.delete(normalized);
      }
    }

    const shortMessage = normalized.length <= 8;
    const threshold = shortMessage
      ? this.options.r9kShortThreshold
      : this.options.r9kThreshold;
    const maxMessages = this.options.r9kMaxHistoryMessages;
    const earliest = ts - maxWindowMs;
    const window = this.window;

    let checkedCount = 0;
    for (let i = window.length - 1; i >= 0; i -= 1) {
      const previous = window[i];
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

  /**
   * Apply an asynchronously fetched Twitch account age to records that are
   * still in the analysis window. Returns true when a row/score changed and
   * the UI should refresh.
   */
  applyAccountAge(login, ageDays) {
    const key = String(login || '').toLowerCase();
    if (!key || !Number.isFinite(ageDays) || ageDays < 0) {
      return false;
    }
    const previous = this.accountAges.get(key);
    this.accountAges.set(key, ageDays);
    const wantFresh = ageDays < this.options.freshAccountAgeDays;
    let changed = previous !== ageDays;

    for (const record of this.session.records) {
      if (record.login !== key) {
        continue;
      }

      record.accountAgeDays = ageDays;
      record.accountAgeSource = 'api';

      if (record.roleExempt || record.serviceBot) {
        continue;
      }
      if (!record.unbadged || record.color) {
        continue;
      }

      let trigger = null;
      for (let t = 0; t < record.triggers.length; t += 1) {
        if (record.triggers[t].key === 'fresh-account') {
          trigger = record.triggers[t];
          break;
        }
      }

      if (wantFresh && !trigger) {
        record.freshAccount = true;
        record.botScore = clamp(
          record.botScore + WEIGHTS.freshAccount,
          0,
          100
        );
        // Triggers carry an i18n key; the label is the Russian rendering kept
        // for the JSON audit log and for callers that do not translate.
        record.triggers.push({
          key: 'fresh-account',
          labelKey: 'trigger.freshAccount',
          labelParams: { days: ageDays },
          label: `Новый аккаунт (${ageDays} дн.)`,
          points: WEIGHTS.freshAccount,
        });
        changed = true;
      } else if (!wantFresh && trigger) {
        record.freshAccount = false;
        record.botScore = clamp(
          record.triggers.reduce((total, entry) => total +
            (entry === trigger ? 0 : entry.points), 0),
          0,
          100
        );
        record.triggers = record.triggers.filter(
          (entry) => entry.key !== 'fresh-account'
        );
        changed = true;
      } else if (wantFresh && trigger) {
        record.freshAccount = true;
        const label = `Новый аккаунт (${ageDays} дн.)`;
        if (trigger.label !== label) {
          trigger.label = label;
          trigger.labelKey = 'trigger.freshAccount';
          trigger.labelParams = { days: ageDays };
          changed = true;
        }
      } else if (record.freshAccount) {
        record.freshAccount = false;
        changed = true;
      }
    }

    return changed;
  }

  _applyWaveBoost(record) {
    if (!record.unbadged || record.roleExempt || record.waveBoost) {
      return false;
    }
    record.waveBoost = true;
    record.botScore = clamp(record.botScore + WEIGHTS.botWave, 0, 100);
    record.triggers.push({
      key: 'wave',
      labelKey: 'trigger.wave',
      label: 'Волна ботов',
      points: WEIGHTS.botWave,
    });
    return true;
  }

  /**
   * Ingest one parsed PRIVMSG and compute botScore (0-100) and R9K flag.
   */
  ingest(message, now) {
    const currentTime = Number.isFinite(now) ? now : Date.now();
    if (!message || typeof message !== 'object') {
      return { record: null, duplicate: false, waveTriggered: false };
    }

    const text = typeof message.text === 'string' ? message.text.slice(0, 2000) : '';
    if (!text.trim()) {
      return { record: null, duplicate: false, waveTriggered: false };
    }

    const login = String(message.login || message.displayName || '')
      .trim()
      .toLowerCase();
    if (!login) {
      return { record: null, duplicate: false, waveTriggered: false };
    }

    this._prune(currentTime);

    const id = message.id ? String(message.id) : '';
    // The synchronous bridge and the postMessage fallback can deliver the same
    // message twice. Twitch almost always sends an id, but keep a stable local
    // dedupe key for the rare id-less frame.
    const dedupeId =
      id ||
      'local:' +
        String(message.login || '').toLowerCase() +
        ':' +
        String(message.ts || currentTime) +
        ':' +
        text.slice(0, 80);
    if (!this.session.markSeen(dedupeId, currentTime)) {
      return { record: null, duplicate: true, waveTriggered: false };
    }

    let ts = Number(message.ts);
    if (!Number.isFinite(ts) || ts <= 0) {
      ts = currentTime;
    }

    const badges = badgesArray(message.badges);
    const hasBadges = badges.length > 0;
    const unbadged = !hasBadges;
    const serviceBot = Boolean(SERVICE_BOT_LOGINS[login]);
    const roleExempt =
      serviceBot || badges.some((badge) => Boolean(PRIVILEGED_BADGES[badge]));
    const displayName = String(message.displayName || login);
    const numericUserId = parseNumericId(message.userId);
    const userKey = Number.isSafeInteger(numericUserId)
      ? 'id:' + numericUserId
      : 'login:' + login;

    const hasDigitPattern = hasNumericSuffixPattern(login);
    const normalized = normalizeText(text);
    const r9kMatch = serviceBot
      ? null
      : this._findR9KMatch(normalized, ts);
    // The index only contains unbadged accounts from the rolling session
    // window, so a peer count is "other empty accounts with a close id".
    const clusterPeers = unbadged
      ? this.cluster.countPeers(numericUserId, this.options.idClusterRadius)
      : 0;
    const apiAgeDays = this.accountAges.get(login);
    const hasApiAge = Number.isFinite(apiAgeDays);
    const freshAccount =
      unbadged && !message.color && hasApiAge && apiAgeDays < this.options.freshAccountAgeDays;

    if (unbadged && Number.isSafeInteger(numericUserId)) {
      this.cluster.add(numericUserId, ts);
    }

    const user = this.session.getUserState(userKey, login, displayName, ts);
    const rhythm = detectRhythm(user.recentTs.concat([ts]));
    const sterile = unbadged && isSterileText(text, badges);
    const solicitation =
      !roleExempt && unbadged && isSolicitation(text);
    const spamFlood = isCharacterFlood(text);

    const selfPool = user.recentNorm
      .concat(normalized ? [normalized] : [])
      .slice(-this.options.selfHistorySize);
    const selfSimilarity = findSelfSimilarity(
      selfPool,
      this.options.selfJaccardThreshold
    );

    // Single source of truth for the 100-point matrix. The wave weight is
    // applied later, after the base score is known.
    let score = 0;
    const triggers = [];

    if (!roleExempt) {
      if (!hasBadges) {
        score += WEIGHTS.noBadges;
        triggers.push({
          key: 'no-badges',
          labelKey: 'trigger.auto.no-badges',
          label: 'Нет значков',
          points: WEIGHTS.noBadges,
        });
      }
      if (!message.color) {
        score += WEIGHTS.defaultColor;
        triggers.push({
          key: 'default-color',
          labelKey: 'trigger.auto.default-color',
          label: 'Дефолтный цвет',
          points: WEIGHTS.defaultColor,
        });
      }
      if (hasDigitPattern) {
        score += WEIGHTS.usernameDigits;
        triggers.push({
          key: 'username-digits',
          labelKey: 'trigger.auto.username-digits',
          label: 'Цифровой суффикс ника',
          points: WEIGHTS.usernameDigits,
        });
      }
      if (message.firstMsg === true || message.firstMsg === '1') {
        score += WEIGHTS.firstMessage;
        triggers.push({
          key: 'first-msg',
          labelKey: 'trigger.auto.first-msg',
          label: 'Первое сообщение',
          points: WEIGHTS.firstMessage,
        });
      }
      if (clusterPeers >= 2) {
        score += WEIGHTS.idCluster;
        triggers.push({
          key: 'id-cluster',
          labelKey: 'trigger.auto.id-cluster',
          peers: clusterPeers,
          label: 'Кластер ID ×' + (clusterPeers + 1),
          points: WEIGHTS.idCluster,
        });
      }
      if (freshAccount) {
        score += WEIGHTS.freshAccount;
        triggers.push({
          key: 'fresh-account',
          labelKey: 'trigger.freshAccount',
          labelParams: { days: apiAgeDays },
          label: `Новый аккаунт (${apiAgeDays} дн.)`,
          points: WEIGHTS.freshAccount,
        });
      }
      // Rhythm and sterile text are separate keys so audit dumps can be
      // filtered by either signal; each contributes half of the old weight.
      if (rhythm) {
        score += WEIGHTS.mechanicalRhythm;
        triggers.push({
          key: 'mechanical-rhythm',
          labelKey: 'trigger.auto.mechanical-rhythm',
          label: 'Механический ритм',
          points: WEIGHTS.mechanicalRhythm,
        });
      }
      if (sterile) {
        score += WEIGHTS.sterileText;
        triggers.push({
          key: 'sterile-text',
          labelKey: 'trigger.auto.sterile-text',
          label: 'Стерильный текст',
          points: WEIGHTS.sterileText,
        });
      }
      if (selfSimilarity > 0) {
        score += WEIGHTS.selfRepeat;
        triggers.push({
          key: 'self-repeat',
          labelKey: 'trigger.auto.self-repeat',
          label: 'Самоповторы',
          points: WEIGHTS.selfRepeat,
        });
      }
      if (solicitation) {
        score += HARD_SIGNAL_WEIGHTS.solicitation;
        triggers.push({
          key: 'solicitation',
          labelKey: 'trigger.auto.solicitation',
          label: 'Скам / попрошайничество',
          points: HARD_SIGNAL_WEIGHTS.solicitation,
        });
      }
      if (spamFlood) {
        triggers.push({
          key: 'char-flood',
          labelKey: 'trigger.auto.char-flood',
          label: 'Флуд символами',
          points: 0,
        });
      }
    }

    score = clamp(score, 0, 100);

    const record = {
      id: id || 'local:' + userKey + ':' + ts + ':' + this.totalMessages,
      ts,
      receivedAt: message.receivedAt ?? currentTime,
      serverTimestamp: message.serverTimestamp === true,
      channel: String(message.channel || '').toLowerCase(),
      userId: Number.isSafeInteger(numericUserId) ? numericUserId : null,
      numericUserId,
      userKey,
      login,
      displayName,
      badges,
      color: message.color || '',
      firstMsg: message.firstMsg === true || message.firstMsg === '1',
      text,
      normalized,
      unbadged,
      roleExempt,
      serviceBot,
      freshAccount,
      solicitation,
      accountAgeDays: hasApiAge ? apiAgeDays : null,
      accountAgeSource: hasApiAge ? 'api' : null,
      clusterPeers,
      spamFlood,
      botScore: score,
      triggers,
      isR9KDuplicate: Boolean(r9kMatch),
      r9kSimilarity: r9kMatch ? r9kMatch.similarity : 0,
      r9kMatchId: r9kMatch ? r9kMatch.record.id : null,
      selfSimilarity: round(selfSimilarity, 3),
      bucketStart:
        Math.floor(ts / this.options.bucketMs) * this.options.bucketMs,
      waveBoost: false,
    };

    this.window.push(record);
    if (this.window.length > this.options.windowSize) {
      this.window.shift();
    }
    if (!serviceBot && normalized.length >= this.options.r9kMinLength) {
      this.r9kExact.set(normalized, {
        ts,
        id: record.id,
        userKey,
      });
    }

    this.firstRecordTs =
      this.firstRecordTs === null ? ts : Math.min(this.firstRecordTs, ts);
    this.session.commit(record, normalized);
    this.totalMessages += 1;

    const waveInfo = this.waves.observe(record);
    if (waveInfo.waveTriggered) {
      waveInfo.bucket.authors = new Set();
      waveInfo.bucket.event = {
        kind: 'chat-wave', ts: currentTime, bucketStart: record.bucketStart,
        messages: 0, authors: 0,
      };
      this.waveCount += 1;
      this.lastWave = waveInfo.bucket.event;
    }
    if (waveInfo.wave) {
      const { bucket } = waveInfo;
      for (const entry of waveInfo.waveTriggered ? bucket.records : [record]) {
        if (this._applyWaveBoost(entry)) {
          bucket.authors.add(entry.userKey);
          bucket.event.messages += 1;
        }
      }
      bucket.event.authors = bucket.authors.size;
    }

    if (waveInfo.waveTriggered) {
      const context = recordsAt(this.session.records, currentTime);
      const subjects = context.filter((entry) =>
        entry.bucketStart === record.bucketStart && entry.waveBoost);
      const members = new Set(subjects.map((entry) => entry.userKey));
      waveInfo.bucket.event.atTrigger = {
        ts: currentTime,
        rule: ID_GROUP_RULE,
        groups: describeGroups(findIdGroups(context), context),
        ...summarizeMatches(subjects, context, members),
      };
    }

    // Save to audit log if enabled and meets criteria
    if (
      this.options.enableAuditLog &&
      (record.botScore >= this.options.suspiciousThreshold ||
        record.isR9KDuplicate ||
        record.spamFlood)
    ) {
      this.logger.add(record);
    }

    return {
      record,
      duplicate: false,
      waveTriggered: waveInfo.waveTriggered,
      waveEvent: waveInfo.bucket.event,
    };
  }

  getStats(now, since) {
    const currentTime = Number.isFinite(now) ? now : Date.now();
    this._prune(currentTime);

    const stats = this.session.getStats(currentTime, since);
    if (!this.idGroupSnapshot || currentTime - this.idGroupSnapshot.ts >= 60000) {
      const groups = findIdGroups(recordsAt(this.session.records, currentTime));
      this.idGroupSnapshot = {
        ts: currentTime, count: groups.length,
        authors: groups.reduce((total, group) => total + group.memberIds.length, 0),
      };
      const byId = new Map(groups.flatMap((group) => group.memberIds.map((id) => [id, group])));
      this.idGroupsById = byId;
    }
    const isBotWave = this.waves.isWaveActive(currentTime);
    const observedMs = Number.isFinite(since)
      ? Math.max(0, currentTime - since)
      : this.firstRecordTs === null
        ? 0
        : Math.max(0, currentTime - this.firstRecordTs);

    return Object.assign({}, stats, {
      idGroups: this.idGroupSnapshot,
      isBotWave,
      waveAlert: isBotWave || Boolean(this.lastWave && currentTime - this.lastWave.ts < 30000),
      waveCount: this.waveCount,
      lastWave: this.lastWave && { ...this.lastWave },
      waveBucketStart: isBotWave
        ? this.waves.getActiveWaveBucket(currentTime)
        : null,
      windowSize: this.window.length,
      totalMessages: this.totalMessages,
      auditLogCount: this.logger.count(),
      sessionMs: observedMs,
      observedMinutes: Math.round((observedMs / 60000) * 10) / 10,
      clusterIndexSize: this.cluster.size,
    });
  }
}
