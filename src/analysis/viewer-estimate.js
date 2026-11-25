/*
 * Twitch Chat X-Ray — chat-based live viewer estimate.
 *
 * Why not "official viewers × (1 − bot share in chat)"?
 * A viewbot only has to load the video player: it never joins IRC and never
 * writes a message. The share of suspicious *chatters* therefore says nothing
 * about the share of suspicious *viewers*, and subtracting it from 50 000 is
 * how the old model arrived at an inflated 35 000–37 000.
 *
 * The observable signal is chat engagement. On an organic stream roughly
 * 8–12.5% of the live audience writes something during a 10-minute window, so
 * each clean unique chatter represents ~8–12.5 viewers. A bot-inflated stream
 * shows tens of thousands of viewers with a handful of chatters, and that is
 * what this module extrapolates into a *range*.
 *
 * The estimate is a heuristic, not a measurement. It is deliberately shown as
 * a range alongside the duration of the observation.
 */
export const VIEWER_ESTIMATE_DEFAULTS = Object.freeze({
  referenceWindowMs: 10 * 60 * 1000,
  minSessionMs: 2 * 60 * 1000,
  maxSessionScale: 4,
  // 1 clean chatter ≈ 8..12.5 live viewers (8–12.5% engaged during 10 min).
  viewersPerChatterLow: 8,
  viewersPerChatterHigh: 12.5,
  minCleanChatters: 2,
  minWindowMessages: 5,
  lowConfidenceMs: 5 * 60 * 1000,
  // Engagement-rate alarm: below 2.5% at 1 000+ viewers is the main signal.
  erAlertPercent: 2.5,
  // Softer attention band: below the low end of the organic 6–12.5% range the
  // extrapolated audience is visibly smaller than the official number.
  erSoftPercent: 6,
  erAlertMinViewers: 1000,
  erAlertMinSessionMs: 10 * 60 * 1000,
});

export function roundViewerBound(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 100000) {
    return Math.round(value / 1000) * 1000;
  }
  if (value >= 10000) {
    return Math.round(value / 500) * 500;
  }
  if (value >= 1000) {
    return Math.round(value / 100) * 100;
  }
  if (value >= 100) {
    return Math.round(value / 10) * 10;
  }
  return Math.round(value);
}

/**
 * Extrapolate live viewers from clean unique chatters.
 *
 * `stats` is the analyzer snapshot:
 *   activeUsers, cleanUsers, windowMessages, sessionMs.
 * `officialViewers` should be the *smoothed* official count (median), so bot
 * churn does not make the estimate jump.
 */
export function estimateViewerRange(officialViewers, stats, options) {
  const settings = Object.assign({}, VIEWER_ESTIMATE_DEFAULTS, options || {});
  if (!Number.isFinite(officialViewers) || officialViewers <= 0) {
    return null;
  }

  const cleanChatters = Math.max(0, Number(stats.cleanUsers) || 0);
  const activeUsers = Math.max(0, Number(stats.activeUsers) || 0);
  const windowMessages = Math.max(0, Number(stats.audienceMessages ?? stats.windowMessages) || 0);
  const rawSessionMs = Math.max(0, Number(stats.sessionMs) || 0);
  const sessionMs = Math.min(settings.referenceWindowMs, rawSessionMs);

  if (cleanChatters < settings.minCleanChatters) {
    return null;
  }
  if (activeUsers < settings.minCleanChatters) {
    return null;
  }
  if (windowMessages < settings.minWindowMessages) {
    return null;
  }
  if (sessionMs < settings.minSessionMs) {
    return null;
  }

  // A short observation has fewer chatters simply because less time passed.
  // Scale up to the 10-minute reference, but never extrapolate more than 4×.
  const scale = Math.min(
    settings.maxSessionScale,
    settings.referenceWindowMs / sessionMs
  );
  const effectiveChatters = cleanChatters * scale;

  let low = roundViewerBound(effectiveChatters * settings.viewersPerChatterLow);
  let high = roundViewerBound(effectiveChatters * settings.viewersPerChatterHigh);

  const lowConfidence = sessionMs < settings.lowConfidenceMs;
  if (lowConfidence) {
    // Widen the band when the sample is short instead of pretending precision.
    low = roundViewerBound(low * 0.7);
    high = roundViewerBound(high * 1.35);
  }

  // Viewbots only inflate the official number, so the real audience cannot
  // exceed it. It also cannot be smaller than the clean chatters we saw.
  high = Math.min(high, officialViewers);
  low = Math.min(low, high);
  low = Math.max(low, Math.min(cleanChatters, high));

  const midpoint = Math.round((low + high) / 2);
  const confidence =
    sessionMs >= settings.referenceWindowMs
      ? 'high'
      : sessionMs >= settings.lowConfidenceMs
        ? 'medium'
        : 'low';

  return {
    low,
    high,
    midpoint,
    cleanChatters,
    effectiveChatters: Math.round(effectiveChatters),
    sessionScale: Math.round(scale * 100) / 100,
    confidence,
    assumptions: {
      viewersPerChatterLow: settings.viewersPerChatterLow,
      viewersPerChatterHigh: settings.viewersPerChatterHigh,
      referenceWindowMs: settings.referenceWindowMs,
    },
  };
}

/**
 * Chat engagement rate (ER): clean unique chatters / official viewers.
 * It is only meaningful after the chat had time to accumulate, hence the
 * `measurable` gate; before 10 minutes the rate is shown as provisional.
 */
export function getChatEngagement(officialViewers, stats, options) {
  const settings = Object.assign({}, VIEWER_ESTIMATE_DEFAULTS, options || {});
  if (!Number.isFinite(officialViewers) || officialViewers <= 0) {
    return null;
  }

  const cleanChatters = Math.max(0, Number(stats.cleanUsers) || 0);
  const sessionMs = Math.max(0, Number(stats.sessionMs) || 0);
  const ratio = cleanChatters / officialViewers;
  const percent = ratio * 100;
  const measurable = sessionMs >= settings.erAlertMinSessionMs;

  const evaluateLowEngagement = measurable && !stats.mixedMode && ['open', 'followers'].includes(stats.chatAccess) &&
    !stats.roomMode?.slow && !stats.roomMode?.emotes &&
    officialViewers >= settings.erAlertMinViewers;

  return {
    percent,
    ratio,
    cleanChatters,
    officialViewers,
    thresholdPercent: settings.erAlertPercent,
    measurable,
    alert:
      evaluateLowEngagement &&
      percent < settings.erAlertPercent,
    belowOrganicBand:
      evaluateLowEngagement &&
      percent < settings.erSoftPercent,
  };
}

/**
 * Loading progress for the inline counter.
 *
 * The viewer range needs a minimum sample before it can be shown, and until
 * then the counter only says "loading". This model exposes the same gates as
 * estimateViewerRange as three named checks plus a bot-wave flag, so the UI can
 * print "Loading… 66%" and explain in the tooltip which sample it is waiting
 * for. Progress is capped at 99 until the wave flag is known, and 100 means
 * "ready" (a ready counter usually replaces the percentage with the range).
 */
export function getLoadingProgress(stats, options) {
  const settings = Object.assign({}, VIEWER_ESTIMATE_DEFAULTS, options || {});
  const source = stats || {};
  const sessionMs = Math.max(0, Number(source.sessionMs) || 0);
  const chatters = Math.max(0, Number(source.cleanUsers) || 0);
  const messages = Math.max(0, Number(source.audienceMessages ?? source.windowMessages) || 0);
  const isBotWave = Boolean(source.isBotWave);

  // A bot wave is an alarm, not a completeness requirement: it gets a 0-weight
  // slot and never blocks readiness.
  const checks = [
    {
      key: 'duration',
      value: Math.round(sessionMs / 60000),
      required: Math.round(settings.minSessionMs / 60000),
      weight: 1,
      done: sessionMs >= settings.minSessionMs,
    },
    {
      key: 'chatters',
      value: chatters,
      required: settings.minCleanChatters,
      weight: 1,
      done: chatters >= settings.minCleanChatters,
    },
    {
      key: 'messages',
      value: messages,
      required: settings.minWindowMessages,
      weight: 1,
      done: messages >= settings.minWindowMessages,
    },
    {
      key: 'wave',
      value: isBotWave ? 1 : 0,
      required: 0,
      weight: 0,
      done: true,
      active: isBotWave,
    },
  ];

  let total = 0;
  let filled = 0;
  for (let i = 0; i < checks.length; i += 1) {
    const check = checks[i];
    if (!check.weight) {
      continue;
    }
    total += check.weight;
    if (check.done) {
      filled += check.weight;
    } else if (check.required > 0) {
      filled += check.weight * Math.min(1, Math.max(0, check.value / check.required));
    }
  }

  const done = checks.filter((check) => check.weight > 0 && check.done).length;
  const required = checks.filter((check) => check.weight > 0).length;
  const ready = done === required;
  const raw = total > 0 ? Math.round((filled / total) * 100) : 100;

  return {
    percent: ready ? 100 : Math.min(99, Math.max(0, raw)),
    ready,
    done,
    required,
    checks,
  };
}

/**
 * Turn the three independent signals into one human-readable verdict.
 * Priority: engagement + churn together are the strongest combination, then
 * whichever of the two fired, then chat-level bot signals.
 */
export function classifyViewerSignals(input) {
  const { range, engagement, churn, isBotWave, stats } = input || {};
  const activeUsers = Math.max(0, Number(stats && stats.activeUsers) || 0);
  const suspiciousUsers = Math.max(0, Number(stats && stats.suspiciousUsers) || 0);
  const suspiciousShare = activeUsers ? suspiciousUsers / activeUsers : 0;

  // Verdicts are i18n keys: the UI renders them with the active language.
  if (engagement && engagement.alert && churn && churn.churnActive) {
    return {
      level: 'critical',
      key: 'low-er-and-churn',
      labelKey: 'verdict.low-er-and-churn',
    };
  }
  if (churn && (churn.churnActive || churn.churnRecent > 0)) {
    return {
      level: 'warn',
      key: 'churn',
      labelKey: 'verdict.churn',
    };
  }
  if (engagement && engagement.alert) {
    return {
      level: 'warn',
      key: 'low-er',
      labelKey: 'verdict.low-er',
    };
  }
  if (engagement && engagement.belowOrganicBand) {
    return {
      level: 'info',
      key: 'below-organic-er',
      labelKey: 'verdict.below-organic-er',
    };
  }
  if (isBotWave) {
    return {
      level: 'warn',
      key: 'bot-wave',
      labelKey: 'verdict.bot-wave',
    };
  }
  if (suspiciousShare >= 0.35) {
    return {
      level: 'info',
      key: 'chat-bots',
      labelKey: 'verdict.chat-bots',
    };
  }
  if (churn?.totalOutflows || churn?.totalSurges || stats?.waveCount) {
    return { level: 'info', key: 'session-events', labelKey: 'verdict.session-events' };
  }
  if (!range || engagement?.measurable === false) {
    return {
      level: 'unknown',
      key: 'no-data',
      labelKey: 'verdict.no-data',
    };
  }
  return {
    level: 'ok',
    key: 'clean',
    labelKey: 'verdict.clean',
  };
}

/** Verdict label in the requested UI language. */
export function verdictLabel(verdict, t) {
  if (!verdict) {
    return '';
  }
  if (verdict.labelKey && typeof t === 'function') {
    return t(verdict.labelKey);
  }
  return verdict.label || '';
}

/**
 * Pure model builder shared by the counter and the tooltip. Keeping it free of
 * DOM lets the whole estimation path be unit-tested.
 */
export function buildViewerModel(input) {
  const official = Number(input && input.official);
  if (!Number.isFinite(official) || official <= 0) {
    return null;
  }

  const stats = (input && input.stats) || {};
  const history = (input && input.history) || null;
  const baseline = (input && input.baseline) || null;
  const options = (input && input.options) || {};
  const settings = Object.assign({}, VIEWER_ESTIMATE_DEFAULTS, options);

  const stableOfficial =
    history && Number.isFinite(history.median) && history.median > 0
      ? history.median
      : official;

  const range = estimateViewerRange(Math.min(official, stableOfficial), stats, settings);
  // ER is defined against the official number currently displayed, exactly as
  // the on-page metric says. The median can further lower the estimate cap.
  const engagement = getChatEngagement(official, stats, settings);
  const churn = history
    ? {
        churnEvents: history.churnEvents || 0,
        churnRecent:
          history.churnRecent !== undefined
            ? history.churnRecent
            : history.churnEvents || 0,
        totalChurnEvents:
          history.totalChurnEvents !== undefined
            ? history.totalChurnEvents
            : history.churnEvents || 0,
        churnActive: Boolean(history.churnActive),
        lastEvent: history.lastEvent || null,
        lastAnomaly: history.lastAnomaly || null,
        totalSurges: history.totalSurges || 0,
        totalOutflows: history.totalOutflows,
        lastOutflow: history.lastOutflow,
        lastSurge: history.lastSurge,
        averageSurge: history.averageSurge || 0,
        maxDrop: Number(history.maxDrop) || 0,
        totalMaxDrop: Number(history.totalMaxDrop) || Number(history.maxDrop) || 0,
        averageDrop: Number(history.averageDrop) || 0,
        pendingDrop: history.pendingDrop || null,
        volatility: Number(history.volatility) || 0,
        span: Number(history.span) || 0,
        min: history.min,
        max: history.max,
      }
    : null;

  const verdict = classifyViewerSignals({
    range,
    engagement,
    churn,
    isBotWave: Boolean(stats.isBotWave),
    stats,
  });

  return {
    official,
    stableOfficial,
    minute: input.minute || null,
    range,
    engagement,
    churn,
    verdict,
    observedChatters: Math.max(0, (stats.activeUsers || 0) - (stats.serviceBots || 0)),
    audienceMessages: stats.audienceMessages ?? stats.windowMessages,
    activeUsers: Math.max(0, Number(stats.activeUsers) || 0),
    cleanUsers: Math.max(0, Number(stats.cleanUsers) || 0),
    suspiciousUsers: Math.max(0, Number(stats.suspiciousUsers) || 0),
    suspiciousPercent: Math.max(0, Number(stats.suspiciousPercent) || 0),
    chatAccess: stats.chatAccess ?? 'unknown',
    waveCount: stats.waveCount, lastWave: stats.lastWave, waveAlert: stats.waveAlert,
    roomMode: stats.roomMode, windowModes: stats.windowModes, mixedMode: stats.mixedMode,
    loading: getLoadingProgress(stats, settings),
    freshUsers: Math.max(0, Number(stats.freshUsers) || 0),
    messagesPerMinute: Math.max(0, Number(stats.messagesPerMinute) || 0),
    windowMessages: Math.max(0, Number(stats.windowMessages) || 0),
    sessionMs: Math.max(0, Number(stats.sessionMs) || 0),
    isBotWave: Boolean(stats.isBotWave),
    erBaseline:
      engagement?.measurable && !stats.mixedMode && stats.chatAccess !== 'unknown' && baseline && Number.isFinite(baseline.er)
        ? {
            ...baseline,
            er: baseline.er,
            sessions: Math.max(0, Number(baseline.sessions) || 0),
            threshold: Number(baseline.threshold) || 0,
          }
        : null,
    assumptions: settings,
  };
}
