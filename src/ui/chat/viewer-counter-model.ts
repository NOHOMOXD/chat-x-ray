import { formatAge, formatNumber, formatViewerRangeCompact } from '../shared/ui-utils.ts';
import { getLocale, t } from '../../i18n/i18n.ts';

interface StatusModel {
  range?: unknown;
  churn?: { lastOutflow?: unknown; lastAnomaly?: unknown; totalSurges?: number } | null | undefined;
  engagement?: { alert?: boolean; measurable?: boolean } | null | undefined;
}
interface StatusStats { waveAlert?: boolean; chatConnected?: boolean }
interface CounterModel {
  churn?: { lastOutflow?: unknown; totalSurges?: number } | null | undefined;
  range?: { low: number; high: number } | null | undefined;
  loading?: unknown;
  official?: number | undefined;
  recentAge?: number | null;
  observedChatters?: number | undefined;
  waveCount?: number | undefined;
}

export function buildCounterParts(model: CounterModel) {
  const locale = getLocale();
  if (model.range) {
    const range = formatViewerRangeCompact(model.range, locale, model.official);
    return { text: model.recentAge != null
      ? ' · ' + t('viewer.recent', { range, age: formatAge(model.recentAge) }) : ' (≈' + range + ')' };
  }
  const count = model.observedChatters || 0;
  if (count) return { text: ' (' + formatNumber(count, locale) + ')', label: t('viewer.observed') + ': ' + formatNumber(count, locale) };
  const event = model.waveCount ? 'wave' : model.churn?.lastOutflow ? 'outflow' : model.churn?.totalSurges ? 'surge' : null;
  return { text: event ? ' · ' + t('tip.status.' + event) : '' };
}

export function viewerStatus(model: StatusModel, stats: StatusStats, now: number, alertDuration: number) {
  const candidate = model.churn?.lastOutflow;
  const drop = typeof candidate === 'object' && candidate !== null ? candidate : null;
  if ((drop && 'status' in drop && drop.status === 'observing') || (drop && 'closedAt' in drop && typeof drop.closedAt === 'number' && Number.isFinite(drop.closedAt) &&
      now - drop.closedAt < alertDuration)) return 'outflow';
  const anomaly = model.churn?.lastAnomaly;
  if (typeof anomaly === 'object' && anomaly !== null && 'ts' in anomaly && 'kind' in anomaly &&
      typeof anomaly.ts === 'number' && typeof anomaly.kind === 'string' && now - anomaly.ts < alertDuration) return anomaly.kind;
  if (stats.waveAlert) return 'wave';
  if (model.engagement?.alert) return 'lowEr';
  if (stats.chatConnected === false) return 'disconnected';
  return model.engagement?.measurable && model.range ? 'ok' : 'waiting';
}

