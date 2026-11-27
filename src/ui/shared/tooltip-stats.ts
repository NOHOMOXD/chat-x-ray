import { el, row, statusHead, detailsSection, eventTime } from './tooltip-dom.ts';
import { formatNumber } from './ui-utils.ts';
import { getLocale, t } from '../../i18n/i18n.ts';

export interface StatsTooltipModel {
  activeUsers: number;
  suspiciousPercent: number;
  sessionMs: number;
  messagesPerMinute: number;
  windowMessages: number;
  chatStatus?: string | undefined;
  topAuthorMessages?: number | undefined;
  audienceMessages?: number | undefined;
  neutralUsers?: number | undefined;
  suspiciousUsers?: number | undefined;
  idGroups?: { count: number; authors: number } | null | undefined;
  lastWave?: { ts: number; authors?: number } | null | undefined;
  minuteUsers?: number | undefined;
  auditLogCount?: number | undefined;
  freshUsers?: number | undefined;
  waveCount?: number | undefined;
}

export function buildStatsTooltip(model: StatsTooltipModel) {
  const locale = getLocale();
  const number = (value: unknown) => formatNumber(value, locale);
  const root = el('div', 'tcx-tip tcx-tip--summary');
  const status = model.chatStatus || 'waiting';
  root.appendChild(statusHead(t('stats.title'), t('stats.subtitle'), status));
  const list = el('div', 'tcx-tip__list');
  list.appendChild(row(t('stats.activeLabel'), number(model.activeUsers)));
  if (typeof model.topAuthorMessages === 'number' && Number.isFinite(model.topAuthorMessages) && typeof model.audienceMessages === 'number' && Number.isFinite(model.audienceMessages)) {
    const seconds = Math.min(600, Math.floor(model.sessionMs / 1000));
    const duration = seconds % 60 ? t('tip.seconds', { count: seconds })
      : t('tip.minutes', { minutes: seconds / 60 });
    list.appendChild(row(t('stats.topAuthor', { duration }), model.audienceMessages
      ? t('stats.topShare', { top: number(model.topAuthorMessages), total: number(model.audienceMessages),
          percent: Math.round(100 * model.topAuthorMessages / model.audienceMessages) })
      : t('stats.noMessages')));
  }
  if (Number.isFinite(model.neutralUsers)) list.appendChild(row(t('tip.neutral'), number(model.neutralUsers)));
  const suspicious = model.suspiciousUsers || 0;
  const percent = model.activeUsers ? Math.round(suspicious * 100 / model.activeUsers) : 0;
  list.appendChild(row(t('tip.suspiciousAuthors'),
    number(suspicious) + ' (' + percent + '%)'));
  list.appendChild(row(t('stats.suspiciousLabel'), model.suspiciousPercent + '%'));
  if (model.idGroups) {
    list.appendChild(row(t('tip.idGroups'), t('tip.idGroupCounts', {
      groups: number(model.idGroups.count), authors: number(model.idGroups.authors),
    })));
  }
  if (model.lastWave) {
    list.appendChild(el('div', 'tcx-tip__event-meta', t('tip.lastWave', {
      time: eventTime(model.lastWave.ts), count: number(model.lastWave.authors),
    })));
  }
  root.appendChild(list);
  root.appendChild(el('div', 'tcx-tip__status', t('tip.status.' + status)));

  list.appendChild(row(t('tip.viewer.minute'), t('tip.viewer.minuteChat', {
    authors: number(model.minuteUsers || 0), messages: number(model.messagesPerMinute),
  })));
  list.appendChild(row(t('stats.audit'), number(model.auditLogCount || 0)));
  const details = detailsSection(root);
  details.appendChild(row(t('stats.window'), number(model.windowMessages)));
  details.appendChild(row(t('tip.viewer.fresh'), number(model.freshUsers || 0)));
  details.appendChild(row(t('tip.waveCount'), number(model.waveCount || 0)));
  root.appendChild(el('div', 'tcx-tip__foot tcx-tip__foot--plain', t('stats.foot')));
  return root;
}

