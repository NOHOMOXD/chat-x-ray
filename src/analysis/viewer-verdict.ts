interface SignalInput {
  range?: unknown;
  engagement?: { alert?: boolean; belowOrganicBand?: boolean; measurable?: boolean } | null;
  churn?: { churnActive?: boolean; churnRecent?: number; totalOutflows?: number | undefined; totalSurges?: number } | null;
  isBotWave?: boolean;
  stats?: { activeUsers?: number; suspiciousUsers?: number; waveCount?: number } | null;
}

interface VerdictLabel {
  labelKey?: string;
  label?: string;
}

/**
 * Turn the three independent signals into one human-readable verdict.
 * Priority: engagement + churn together are the strongest combination, then
 * whichever of the two fired, then chat-level bot signals.
 */
export function classifyViewerSignals(input: SignalInput | null | undefined) {
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
  if (churn && (churn.churnActive || Number(churn.churnRecent) > 0)) {
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
export function verdictLabel(verdict: VerdictLabel | null | undefined, t?: (key: string) => string) {
  if (!verdict) {
    return '';
  }
  if (verdict.labelKey && typeof t === 'function') {
    return t(verdict.labelKey);
  }
  return verdict.label || '';
}

