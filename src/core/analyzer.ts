import type { AnalyzerRecord, AnalysisTrigger, BotConfirmation, ChatWaveEvent } from './analyzer-record.ts';
import { normalizeAnalyzerInput } from './analyzer-input.ts';
import { restoreBotConfirmations, updateBotConfirmation } from './bot-confirmation.ts';
import type { ConfirmationRecord } from './bot-confirmation.ts';
import { applyWaveBoost } from './wave-boost.ts';
import { applyAccountAge } from './apply-account-age.ts';
import { scoreMessage, WEIGHTS } from './score-message.ts';
import { ID_GROUP_RULE, describeGroups, findIdGroups, recordsAt, summarizeMatches } from './id-group-diagnostics.ts';
/*
 * Twitch Chat X-Ray — message analyzer.
 * Composes TextAnalysis, ChatSession, BotWaveTracker and BotLogger.
 * Uses a 100-point balanced weight matrix and Chatterino-style adaptive R9K window.
 */
import {
  normalizeText,
  round,
  isSterileText,
  isCharacterFlood,
  isSolicitation,
  detectRhythm,
  findSelfSimilarity,
  hasNumericSuffixPattern,
} from './text-analysis.ts';
import { waveEvidence } from './wave-evidence.ts';
import { BotWaveTracker } from './bot-wave-tracker.ts';
import { ChatSession, isSuspicious } from './chat-session.ts';
import { BotLogger } from '../config/bot-logger.ts';
import { IdClusterIndex } from './id-cluster-index.ts';
import { R9KMatcher } from './r9k-matcher.ts';

import { DEFAULTS, SERVICE_BOT_LOGINS, PRIVILEGED_BADGES } from './analyzer-config.ts';

import { badgesArray, parseNumericId } from './message-identity.ts';

type AnalyzerOptions = { [K in keyof typeof DEFAULTS]: (typeof DEFAULTS)[K] extends boolean ? boolean : number };
type PastWave = ReturnType<typeof waveEvidence>['wave'];
type IdGroup = ReturnType<typeof findIdGroups>[number];


export class Analyzer {
  options: AnalyzerOptions;
  window: AnalyzerRecord[] = [];
  totalMessages = 0;
  firstRecordTs: number | null = null;
  accountAges = new Map<string, number>();
  r9k: R9KMatcher;
  logger: BotLogger;
  session: ChatSession<AnalyzerRecord>;
  cluster: IdClusterIndex;
  waves: BotWaveTracker<AnalyzerRecord>;
  confirmed: Record<string, BotConfirmation> = {};
  bonuses: Record<string, Record<string, { ts: number; trigger: AnalysisTrigger }>> = {};
  confirmationDirty = false;
  previousReasons = new Map<number, Set<string>>();
  pastWaves = new Map<number, PastWave>();
  waveCount = 0;
  lastWave: ChatWaveEvent | null = null;
  idGroupSnapshot: { ts: number; count: number; authors: number } | null = null;
  idGroupsById = new Map<number, IdGroup>();

  constructor(options?: Partial<AnalyzerOptions>) {
    this.options = Object.assign({}, DEFAULTS, options || {});
    this.window = [];
    this.totalMessages = 0;
    this.firstRecordTs = null;
    this.accountAges = new Map();
    this.r9k = new R9KMatcher(this.options);
    this.logger = new BotLogger(200);

    this.session = new ChatSession<AnalyzerRecord>({
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

    this.clearBotMemory();
    this.waveCount = 0;
    this.lastWave = null;
    this.idGroupSnapshot = null;
    this.idGroupsById = new Map();
    this.waves = new BotWaveTracker<AnalyzerRecord>({
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
    this.r9k.reset();
    this.session.reset();
    this.cluster.reset();
    this.waves.reset();
    this.clearBotMemory();
    this.waveCount = 0;
    this.lastWave = null;
    this.idGroupSnapshot = null;
    this.idGroupsById = new Map();
    this.logger.clear();
  }

  get isBotWave() {
    return this.waves.isBotWave;
  }

  clearBotMemory() {
    this.confirmed = {};
    this.bonuses = {};
    this.confirmationDirty = false;
    this.previousReasons = new Map();
    this.pastWaves = new Map();
  }

  restoreBotMemory(checkpoint: unknown, history: unknown = []) {
    restoreBotConfirmations(checkpoint, history, {
      confirmed: this.confirmed,
      bonuses: this.bonuses,
      previousReasons: this.previousReasons,
    });
  }

  updateConfirmation(record: ConfirmationRecord) {
    const changed = updateBotConfirmation(record, {
      confirmed: this.confirmed,
      bonuses: this.bonuses,
      previousReasons: this.previousReasons,
      suspiciousThreshold: this.options.suspiciousThreshold,
    });
    if (changed) this.confirmationDirty = true;
  }

  auditRecord(record: AnalyzerRecord) {
    this.updateConfirmation(record);
    if (!this.options.enableAuditLog) return;
    const suspicious = isSuspicious(record, this.options.suspiciousThreshold);
    if (suspicious || record.isR9KDuplicate || record.spamFlood) {
      this.logger.add(record, suspicious);
    } else {
      this.logger.remove(record.id);
    }
  }

  updateOptions(options?: Partial<AnalyzerOptions>) {
    Object.assign(this.options, options || {});
    this.session.options.suspiciousThreshold = this.options.suspiciousThreshold;
  }

  _prune(now: number) {
    this.session.prune(now);
    this.cluster.prune(now);
    this.waves.prune(now);
    this.r9k.prune(now);
  }

  /**
   * Apply an asynchronously fetched Twitch account age to records that are
   * still in the analysis window. Returns true when a row/score changed and
   * the UI should refresh.
   */
  applyAccountAge(login: string, ageDays: number) {
    return applyAccountAge(login, ageDays, {
      accountAges: this.accountAges,
      freshAccountAgeDays: this.options.freshAccountAgeDays,
      records: this.session.records,
      auditRecord: (record) => this.auditRecord(record),
    });
  }

  /**
   * Ingest one parsed PRIVMSG and compute botScore (0-100) and R9K flag.
   */
  ingest(message: Record<string, unknown> | null | undefined, now?: number) {
    const currentTime = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
    const input = normalizeAnalyzerInput(message);
    if (!input || !message) {
      return { record: null, duplicate: false, waveTriggered: false };
    }
    const { text, login } = input;

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
    const serviceBot = Object.hasOwn(SERVICE_BOT_LOGINS, login) || badges.includes('bot-badge');
    const roleExempt =
      serviceBot || badges.some((badge) => Object.hasOwn(PRIVILEGED_BADGES, badge));
    const displayName = String(message.displayName || login);
    const numericUserId = parseNumericId(message.userId);
    const userKey = Number.isSafeInteger(numericUserId)
      ? 'id:' + numericUserId
      : 'login:' + login;

    const hasDigitPattern = hasNumericSuffixPattern(login);
    const normalized = normalizeText(text);
    const r9kMatch = this.r9k.find(normalized, ts, this.window);
    // The index only contains unbadged accounts from the rolling session
    // window, so a peer count is "other empty accounts with a close id".
    const clusterPeers = unbadged
      ? this.cluster.countPeers(numericUserId, this.options.idClusterRadius)
      : 0;
    const apiAgeDays = this.accountAges.get(login);
    const hasApiAge = typeof apiAgeDays === 'number' && Number.isFinite(apiAgeDays);
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

    const { score, triggers } = scoreMessage({
      roleExempt, hasBadges, color: message.color, firstMsg: message.firstMsg,
      hasDigitPattern, clusterPeers, freshAccount, apiAgeDays,
      rhythm, sterile, selfSimilarity, solicitation, spamFlood,
    });

    const token = text.trim().toLowerCase();
    const record: AnalyzerRecord = {
      command: /^![\p{L}\p{N}_-]+$/u.test(token) ? token : null,
      id: id || 'local:' + userKey + ':' + ts + ':' + this.totalMessages,
      ts,
      receivedAt: typeof message.receivedAt === 'number' ? message.receivedAt : currentTime,
      sequence: this.totalMessages + 1,
      serverTimestamp: message.serverTimestamp === true,
      channel: String(message.channel || '').toLowerCase(),
      userId: Number.isSafeInteger(numericUserId) ? numericUserId : null,
      numericUserId,
      userKey,
      login,
      displayName,
      badges,
      color: typeof message.color === 'string' ? message.color : '',
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
    this.r9k.remember(normalized, ts, record);

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
    const { bucket } = waveInfo;
    const event = bucket.event;
    const authors = bucket.authors;
    if (waveInfo.wave && event && authors) {
      for (const entry of waveInfo.waveTriggered ? bucket.records : [record]) {
        if (applyWaveBoost(entry)) {
          this.auditRecord(entry);
          authors.add(entry.userKey);
          event.messages += 1;
        }
      }
      event.authors = authors.size;
      const prior = [...this.pastWaves].filter(([start]) => start < record.bucketStart).map(([, wave]) => wave);
      const evidence = waveEvidence(bucket.records, prior, this.session.records);
      this.pastWaves.set(record.bucketStart, evidence.wave);
      for (const entry of bucket.records) {
        for (const [key, ids] of [['wave-order', evidence.ordered], ['wave-phrase', evidence.repeated]] as const) {
          if (!entry.waveBoost || entry.numericUserId === null || !ids.has(entry.numericUserId) || entry.triggers.some(t => t.key === key)) continue;
          entry.triggers.push({ key, labelKey: 'trigger.' + key, points: 10 });
          entry.botScore = Math.min(100, entry.botScore + 10);
          this.auditRecord(entry);
        }
      }
    }

    if (waveInfo.waveTriggered && waveInfo.bucket.event) {
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

    this.auditRecord(record);

    return {
      record,
      duplicate: false,
      waveTriggered: waveInfo.waveTriggered,
      waveEvent: waveInfo.bucket.event,
    };
  }

  getStats(now?: number, since?: number, afterSequence?: number) {
    const currentTime = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
    this._prune(currentTime);

    const stats = this.session.getStats(currentTime, since, afterSequence);
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
    const observedMs = typeof since === 'number' && Number.isFinite(since)
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
