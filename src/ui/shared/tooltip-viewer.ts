import { el, row, statusHead, eventTime } from './tooltip-dom.ts';
import { formatAge, formatNumber, formatViewerRange } from './ui-utils.ts';
import { chatModeLabel, formatPercent, getLocale, t } from '../../i18n/i18n.ts';

type ExternalObject = Record<string, unknown>;
function object(value: unknown): ExternalObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as ExternalObject : {};
}
function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
interface Anomaly {
  kind: string; from: number; to: number; delta: number;
  ts?: number | undefined; durationMs?: number | undefined; confirmedAt?: number | undefined;
  startedAt?: number | undefined; status?: string | undefined; recoveredAt?: number | undefined;
  raid?: { ts?: number | undefined; viewers?: number | undefined } | null;
  precedingDrop?: { from: number; to: number; fromTs?: number | undefined; ts?: number | undefined } | null;
}
function anomaly(value: unknown): Anomaly | null {
  const item = object(value);
  const from = numeric(item.from); const to = numeric(item.to); const delta = numeric(item.delta);
  const kind = stringValue(item.kind);
  if (from === undefined || to === undefined || delta === undefined || !kind) return null;
  const raid = object(item.raid);
  const drop = object(item.precedingDrop);
  const dropFrom = numeric(drop.from); const dropTo = numeric(drop.to);
  return {
    kind, from, to, delta, ts: numeric(item.ts), durationMs: numeric(item.durationMs),
    confirmedAt: numeric(item.confirmedAt), startedAt: numeric(item.startedAt),
    status: stringValue(item.status), recoveredAt: numeric(item.recoveredAt),
    raid: item.raid ? { ts: numeric(raid.ts), viewers: numeric(raid.viewers) } : null,
    precedingDrop: dropFrom !== undefined && dropTo !== undefined
      ? { from: dropFrom, to: dropTo, fromTs: numeric(drop.fromTs), ts: numeric(drop.ts) } : null,
  };
}
function readModel(value: unknown) {
  const model = object(value);
  const range = object(model.range); const low = numeric(range.low); const high = numeric(range.high);
  const loading = object(model.loading); const churn = object(model.churn);
  const engagement = object(model.engagement); const minute = object(model.minute);
  const baseline = object(model.erBaseline); const room = object(model.roomMode); const wave = object(model.lastWave);
  const roomMode = { slow: numeric(room.slow), emotes: numeric(room.emotes), unique: numeric(room.unique) };
  return {
    viewerStatus: stringValue(model.viewerStatus), official: numeric(model.official),
    range: low !== undefined && high !== undefined ? { low, high } : null,
    recentAge: numeric(model.recentAge), sessionMs: numeric(model.sessionMs),
    loading: { percent: numeric(loading.percent) }, massCommand: model.massCommand === true,
    waveCount: numeric(model.waveCount), waveAlert: model.waveAlert === true,
    lastWave: model.lastWave ? { authors: numeric(wave.authors) } : null,
    churn: { totalSurges: numeric(churn.totalSurges), totalOutflows: numeric(churn.totalOutflows),
      lastOutflow: anomaly(churn.lastOutflow), lastSurge: anomaly(churn.lastSurge), lastAnomaly: anomaly(churn.lastAnomaly) },
    engagement: model.engagement ? { alert: engagement.alert === true, measurable: engagement.measurable === true,
      percent: numeric(engagement.percent) } : null,
    stale: model.stale === true, chatAccess: stringValue(model.chatAccess) ?? 'unknown', roomMode,
    observedChatters: numeric(model.observedChatters), audienceMessages: numeric(model.audienceMessages),
    windowMessages: numeric(model.windowMessages), cleanUsers: numeric(model.cleanUsers), activeUsers: numeric(model.activeUsers),
    observationMs: numeric(model.observationMs), sampledAt: numeric(model.sampledAt), chatAlert: model.chatAlert === true,
    suspiciousUsers: numeric(model.suspiciousUsers), threshold: numeric(model.threshold), stableOfficial: numeric(model.stableOfficial),
    minute: { from: numeric(minute.from), to: numeric(minute.to) },
    erBaseline: model.erBaseline ? { sessions: numeric(baseline.sessions) ?? 0, er: numeric(baseline.er),
      low: numeric(baseline.low), high: numeric(baseline.high), lastEr: numeric(baseline.lastEr) } : null,
  };
}

function appendAnomaly(list: HTMLElement, event: Anomaly, locale: string) {
  const number = (value: unknown) => formatNumber(value, locale);
  const block = el('div', 'tcx-tip__event');
  const sign = event.delta < 0 ? '−' : '+';
  const seconds = Math.round((event.durationMs || 0) / 1000);
  const duration = event.kind === 'surge' && seconds
    ? ' · ' + (seconds % 60 === 0
      ? t('tip.minutes', { minutes: seconds / 60 })
      : t('tip.seconds', { count: seconds }))
    : '';
  const outflow = event.kind === 'viewer-outflow';
  const label = outflow ? 'tip.lastOutflow' : event.kind === 'churn' ? 'tip.lastChurn' : 'tip.lastSurge';
  const percent = outflow ? ' (' + sign + formatPercent(Math.abs(event.delta) / event.from * 100, locale) + ')' : '';
  block.appendChild(row(t(label), sign + number(Math.abs(event.delta)) + percent + duration));
  block.appendChild(row(t('tip.onlineTransition'), number(event.from) + ' → ' + number(event.to)));
  if (event.confirmedAt && event.startedAt) {
    block.appendChild(row(t('tip.movementTimes'), eventTime(event.startedAt) + ' → ' + eventTime(event.confirmedAt)));
  } else if (Number.isFinite(event.ts)) {
    block.appendChild(row(t('tip.eventTime'), eventTime(event.ts)));
  }
  if (outflow) {
    block.appendChild(el('div', 'tcx-tip__event-meta', t('tip.outflow.' + event.status, {
      time: eventTime(event.recoveredAt),
    })));
  }
  if (event.raid) block.appendChild(row(t('tip.movementRaid'), eventTime(event.raid.ts) + ' · ' + number(event.raid.viewers)));
  if (event.precedingDrop) {
    const drop = event.precedingDrop;
    block.appendChild(el('div', 'tcx-tip__event-meta', t('tip.precedingDrop', {
      values: number(drop.from) + ' → ' + number(drop.to),
      time: eventTime(drop.fromTs) + '–' + eventTime(drop.ts),
    })));
  }
  list.appendChild(block);
}

export function buildViewerTooltip(input: unknown) {
  const model = readModel(input);
  const locale = getLocale();
  const number = (value: unknown) => formatNumber(value, locale);
  const root = el('div', 'tcx-tip tcx-tip--summary tcx-tip--viewer');
  const status = model.viewerStatus || 'waiting';
  root.appendChild(statusHead(t('tip.viewer.title'),
    model.official == null ? '' : t('tip.viewer.official', { value: number(model.official) }), status));

  const hero = el('div', 'tcx-tip__hero');
  if (model.range) {
    hero.appendChild(el('div', 'tcx-tip__hero-value tcx-tip__hero-value--range',
      formatViewerRange(model.range, locale)));
    hero.appendChild(el('div', 'tcx-tip__hero-caption',
      model.recentAge != null ? t('viewer.recentCaption', { age: formatAge(model.recentAge) }) : t('tip.estimate') + ((model.sessionMs ?? Infinity) < 600000 ? ' · ' + t('tip.provisional') : '')));
  }
  if (hero.childElementCount) {
    root.appendChild(hero);
  }

  const list = el('div', 'tcx-tip__list');
  if (!model.range || model.recentAge != null) {
    const progress = el('div', 'tcx-progress');
    const label = el('span', 'tcx-progress-label');
    label.appendChild(el('span', '', t('tip.gatheringLabel')));
    const dots = el('span', 'tcx-progress-dots', '…');
    dots.setAttribute('aria-hidden', 'true');
    label.appendChild(dots);
    progress.append(label, el('strong', 'tcx-progress-value', (model.loading?.percent ?? 0) + '%'));
    root.appendChild(progress);
  }
  const summary = [];
  if (model.massCommand) summary.push(t('tip.massCommand'));
  if (model.waveCount) summary.push(t('tip.waveSummary', { count: model.waveCount,
    label: t('tip.waves.' + new Intl.PluralRules(locale).select(model.waveCount)) }));
  if (model.waveAlert && model.lastWave) summary.push(t('tip.waveAuthors', { count: model.lastWave.authors }));
  if (model.churn?.totalSurges) summary.push(t('tip.surges') + ' · ' + model.churn.totalSurges);
  const drop = model.churn?.lastOutflow;
  if (drop?.from && Number.isFinite(drop.delta)) {
    summary.push(t('tip.dropSummary') + ' ' + formatPercent(-drop.delta / drop.from * 100, locale, 1));
    if (drop.status === 'recovered') summary.push(t('tip.dropRecovered'));
  }
  if (model.engagement?.alert) summary.push(t('tip.status.lowEr'));
  if (model.stale || status === 'disconnected' || (!summary.length && model.range && status !== 'waiting')) summary.unshift(t('tip.status.' + status));
  if (summary.length) root.appendChild(el('strong', 'tcx-tip__status', summary.join(' · ')));
  const mode = chatModeLabel({ chatAccess: model.chatAccess, roomMode: {
    ...(model.roomMode.slow === undefined ? {} : { slow: model.roomMode.slow }),
    ...(model.roomMode.emotes === undefined ? {} : { emotes: model.roomMode.emotes }),
    ...(model.roomMode.unique === undefined ? {} : { unique: model.roomMode.unique }),
  } });
  if (mode) root.appendChild(el('div', 'tcx-tip__note', mode));
  if (model.range) root.appendChild(el('div', 'tcx-tip__note', t('tip.estimateNote')));
  if (!model.range) {
    list.appendChild(row(t('viewer.observed'), number(model.observedChatters || 0)));
    list.appendChild(row(t('tip.windowMessages'), number(model.audienceMessages ?? model.windowMessages ?? 0)));
    if (model.churn?.lastSurge) appendAnomaly(list, model.churn.lastSurge, locale);
    if (model.churn?.lastOutflow) appendAnomaly(list, model.churn.lastOutflow, locale);
    root.appendChild(list);
    return root;
  }
  if (Number.isFinite(model.cleanUsers)) {
    list.appendChild(row(t('tip.viewer.clean'),
      t('tip.viewer.cleanValue', { clean: number(model.cleanUsers), active: number(model.activeUsers) })));
  }
  if (Number.isFinite(model.windowMessages)) list.appendChild(row(t('tip.windowMessages'), number(model.windowMessages)));
  if (model.engagement && Number.isFinite(model.engagement.percent)) {
    list.appendChild(row(t(model.engagement.measurable ? 'tip.viewer.er' : 'tip.viewer.erProvisional'),
      formatPercent(model.engagement.percent, locale)));
  }
  const elapsed = Math.floor((model.observationMs ?? model.sessionMs ?? 0) / 60000);
  const covered = Math.min(10, Math.floor((model.sessionMs ?? 0) / 60000));
  const duration = elapsed >= 60
    ? t('tip.hoursMinutes', { hours: Math.floor(elapsed / 60), minutes: elapsed % 60 })
    : t('tip.minutes', { minutes: elapsed });
  if (model.stale) {
    list.appendChild(row(t('tip.lastMeasurementLabel'), eventTime(model.sampledAt)));
  } else {
    list.appendChild(row(t('tip.observationLabel'), duration));
    list.appendChild(row(t('tip.viewer.window'), t(
      covered === 10 ? 'tip.sliding' : 'tip.covered', { minutes: covered }
    )));
  }
  if (!model.stale && model.chatAlert && !model.waveAlert && model.activeUsers) {
    list.appendChild(row(t('tip.chatAlertLabel'), t('tip.chatAlertValue', {
      suspicious: number(model.suspiciousUsers), active: number(model.activeUsers),
      threshold: model.threshold,
    })));
  }
  root.appendChild(list);
  if (Number.isFinite(model.stableOfficial)) {
    list.appendChild(row(t('tip.medianLabel'), number(model.stableOfficial)));
  }
  if (Number.isFinite(model.minute?.from) && Number.isFinite(model.minute?.to)) {
    list.appendChild(row(t('tip.viewer.minuteViewers'), number(model.minute.from) + ' → ' + number(model.minute.to)));
  }
  const baseline = model.erBaseline;
  if (baseline) {
    const percent = (value: unknown) => formatPercent(value, locale);
    if (baseline.sessions >= 5 && baseline.low !== undefined && baseline.high !== undefined) {
      list.appendChild(row(t('tip.history.typical'), t('tip.history.range', {
        median: percent(baseline.er), low: percent(baseline.low),
        high: percent(baseline.high), count: baseline.sessions,
      })));
      if (!model.stale && model.engagement?.measurable) {
        const value = model.engagement.percent ?? 0;
        const relation = value < baseline.low ? 'low' : value > baseline.high ? 'high' : 'normal';
        list.appendChild(row(t('tip.history.relation'), t('tip.history.' + relation)));
      }
    } else {
      list.appendChild(row(t('tip.history.previous'), percent(baseline.lastEr ?? baseline.er)));
    }
  }
  const churn = model.churn;
  list.appendChild(el('div', 'tcx-tip__event-meta', t('tip.viewer.anomalies')));
  list.appendChild(row(t('tip.surges'), number(churn?.totalSurges ?? 0)));
  list.appendChild(row(t('tip.outflows'), churn?.totalOutflows == null
    ? t('tip.noEventData') : number(churn.totalOutflows)));
  const surge = churn?.lastSurge || (churn?.lastAnomaly?.kind === 'surge' && churn.lastAnomaly);
  if (surge) {
    appendAnomaly(list, surge, locale);
  }
  const outflow = churn?.lastOutflow;
  if (outflow) {
    appendAnomaly(list, outflow, locale);
  } else if (churn?.lastAnomaly?.kind === 'churn') {
    appendAnomaly(list, churn.lastAnomaly, locale);
  }

  return root;
}

