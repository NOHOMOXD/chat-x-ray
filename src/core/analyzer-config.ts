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
// are not viewbots and must not be scored as suspicious. R9K still applies to
// them: a bot flooding chat is a bot flooding chat.
//
// This list is a legacy convenience only. The objective signal is the official
// `bot-badge` that Twitch itself sets on bot accounts (see PRIVILEGED_BADGES).
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
  // Twitch's own marker for verified bot accounts. Objective: no whitelist of
  // logins can ever be complete, the badge is assigned by the platform.
  'bot-badge': true,
});

