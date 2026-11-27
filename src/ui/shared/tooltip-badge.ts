import { el, head } from './tooltip-dom.ts';
import { botHue, formatNumber } from './ui-utils.ts';
import { getLocale, t } from '../../i18n/i18n.ts';

interface BadgeTrigger {
  key: string;
  labelKey?: string;
  label?: string;
  points?: number;
  peers?: number;
  labelParams?: Record<string, unknown>;
}
export interface IdGroup { memberIds: number[]; from: number; to: number }
export interface GroupHistory { groupBroadcasts: number; coordinatedBroadcasts: number }
interface BadgeModel {
  score: number;
  threshold: number;
  triggers: BadgeTrigger[];
  idGroup: IdGroup | null | undefined;
  groupHistory: GroupHistory | null | undefined;
  observedBroadcasts?: number | undefined;
  isR9KDuplicate?: boolean | undefined;
  spamFlood?: boolean | undefined;
  accountAgeDays?: number | null | undefined;
  groupOnly?: boolean;
  neutral?: boolean;
  r9kSimilarity?: number | undefined;
  roleExempt?: boolean | undefined;
  clientR9K?: boolean;
  isBotWave?: boolean;
}

/** Render a trigger label, preferring its i18n key. */
export function triggerLabel(trigger: BadgeTrigger | null | undefined) {
  if (!trigger) {
    return '';
  }
  if (trigger.labelKey) {
    const suffix =
      trigger.key === 'id-cluster' && typeof trigger.peers === 'number' && Number.isFinite(trigger.peers)
        ? t('trigger.clusterSuffix', { count: trigger.peers + 1 })
        : '';
    return t(trigger.labelKey, trigger.labelParams) + suffix;
  }
  return trigger.label || '';
}

function appendIdGroup(root: HTMLElement, group: IdGroup | null | undefined) {
  if (group) {
    root.appendChild(el('div', 'tcx-tip__note', t('tip.idGroup', {
      count: group.memberIds.length,
      from: formatNumber(group.from, getLocale()),
      to: formatNumber(group.to, getLocale()),
    })));
  }
}

function appendGroupHistory(root: HTMLElement, model: BadgeModel) {
  if (model.groupHistory && model.groupHistory.groupBroadcasts > 0) {
    root.appendChild(el('div', 'tcx-tip__note', t('tip.history.group', {
      count: model.groupHistory.groupBroadcasts, total: model.observedBroadcasts,
    })));
  }
  if (model.groupHistory && model.groupHistory.coordinatedBroadcasts > 0) {
    root.appendChild(el('div', 'tcx-tip__note', t('tip.history.coordination', {
      count: model.groupHistory.coordinatedBroadcasts,
    })));
  }
}

export function buildBadgeTooltip(model: BadgeModel) {
  const root = el('div', 'tcx-tip');
  if (model.groupOnly) {
    root.appendChild(el('div', 'tcx-tip__title', t('tip.idGroups')));
    const repeat = model.triggers?.find((trigger) => trigger.key === 'group-recurrence');
    if (repeat) root.appendChild(el('div', 'tcx-tip__note', triggerLabel(repeat) + ' (+' + repeat.points + ')'));
    appendIdGroup(root, model.idGroup);
    appendGroupHistory(root, model);
    return root;
  }
  const hue = botHue(model.score, model.threshold);
  root.style.setProperty('--tcx-tip-hue', String(hue));

  root.appendChild(
    head(
      model.neutral ? model.score + '?' : t('tip.badge.points', { score: model.score }),
      model.roleExempt
        ? t('tip.badge.exempt')
        : t('tip.badge.subtitle'),
      hue
    )
  );

  if (model.neutral) root.appendChild(el('div', 'tcx-tip__note', t('tip.pendingBehavior')));
  const meter = el('div', 'tcx-tip__meter');
  const fill = el('span', 'tcx-tip__meter-fill');
  fill.style.width = `${Math.min(100, Math.max(0, model.score))}%`;
  meter.appendChild(fill);
  root.appendChild(meter);

  const triggers = (model.triggers || []).filter(
    (trigger) => trigger.labelKey || trigger.label
  );
  if (triggers.length) {
    const list = el('div', 'tcx-tip__list');
    triggers.forEach((trigger) => {
      const line = el('div', 'tcx-tip__trigger');
      const label = el('span', 'tcx-tip__trigger-label', triggerLabel(trigger));
      const points = el(
        'span',
        'tcx-tip__points',
        trigger.points ? `+${trigger.points}` : '—'
      );
      if (trigger.key === 'wave') {
        line.classList.add('tcx-tip__trigger--alert');
      }
      line.appendChild(label);
      line.appendChild(points);
      list.appendChild(line);
    });
    root.appendChild(list);
  } else {
    root.appendChild(el('div', 'tcx-tip__empty', t('tip.badge.noTriggers')));
  }

  if (model.isBotWave) {
    root.appendChild(
      el('div', 'tcx-tip__note tcx-tip__note--alert', t('tip.badge.wave'))
    );
  }

  if (model.spamFlood) {
    root.appendChild(el('div', 'tcx-tip__note', t('tip.badge.flood')));
  }

  if (Number.isFinite(model.accountAgeDays)) {
    root.appendChild(
      el(
        'div',
        'tcx-tip__note',
        t('tip.badge.age', { days: model.accountAgeDays })
      )
    );
  }

  if (!Number.isFinite(model.accountAgeDays)) {
    root.appendChild(el('div', 'tcx-tip__note', t('tip.badge.ageUnknown')));
  }

  appendIdGroup(root, model.idGroup);
  appendGroupHistory(root, model);

  if (model.isR9KDuplicate) {
    const r9k = el('div', 'tcx-tip__note');
    r9k.textContent = t('tip.badge.r9k', {
      percent: Math.round((model.r9kSimilarity ?? 0) * 100),
    });
    root.appendChild(r9k);
  }

  const footer = el('div', 'tcx-tip__foot');
  footer.textContent = t('tip.badge.footer', {
    threshold: model.threshold,
    state: model.clientR9K ? 'on' : 'off',
  });
  root.appendChild(footer);
  return root;
}

