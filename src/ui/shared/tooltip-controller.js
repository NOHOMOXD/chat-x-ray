/*
 * Twitch Chat X-Ray — Tippy.js tooltip layer.
 *
 * Tippy is bundled locally (no network requests). Tooltip content is built as
 * DOM nodes, never innerHTML, and all extension-owned tooltip nodes are ignored
 * by the page MutationObserver.
 *
 * Every tooltip is rendered through t() so it follows the UI language.
 */
import tippy from 'tippy.js';
import { botHue, formatNumber } from './ui-utils.js';
import { formatPercent, getLocale, t } from '../../i18n/i18n.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function row(label, value, options = {}) {
  const line = el('div', 'tcx-tip__row');
  line.appendChild(el('span', 'tcx-tip__label', label));
  line.appendChild(
    el('span', options.className || 'tcx-tip__value', String(value))
  );
  return line;
}

function head(title, subtitle, hue) {
  const header = el('div', 'tcx-tip__head');
  const dot = el('span', 'tcx-tip__dot');
  if (Number.isFinite(hue)) {
    dot.style.setProperty('--tcx-tip-hue', String(hue));
  }
  const copy = el('div', 'tcx-tip__head-copy');
  copy.appendChild(el('div', 'tcx-tip__title', title));
  if (subtitle) {
    copy.appendChild(el('div', 'tcx-tip__subtitle', subtitle));
  }
  header.appendChild(dot);
  header.appendChild(copy);
  return header;
}

/** Render a trigger label, preferring its i18n key. */
export function triggerLabel(trigger) {
  if (!trigger) {
    return '';
  }
  if (trigger.labelKey) {
    const suffix =
      trigger.key === 'id-cluster' && Number.isFinite(trigger.peers)
        ? t('trigger.clusterSuffix', { count: trigger.peers + 1 })
        : '';
    return t(trigger.labelKey, trigger.labelParams) + suffix;
  }
  return trigger.label || '';
}

function appendIdGroup(root, group) {
  if (group) {
    root.appendChild(el('div', 'tcx-tip__note', t('tip.idGroup', {
      count: group.memberIds.length,
      from: formatNumber(group.from, getLocale()),
      to: formatNumber(group.to, getLocale()),
    })));
  }
}

export function buildBadgeTooltip(model) {
  const root = el('div', 'tcx-tip');
  if (model.groupOnly) {
    root.appendChild(el('div', 'tcx-tip__title', t('tip.idGroups')));
    appendIdGroup(root, model.idGroup);
    return root;
  }
  const hue = botHue(model.score, model.threshold);
  root.style.setProperty('--tcx-tip-hue', String(hue));

  root.appendChild(
    head(
      `BOT ${model.score}%`,
      model.roleExempt
        ? t('tip.badge.exempt')
        : t('tip.badge.subtitle'),
      hue
    )
  );

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

  if (model.isR9KDuplicate) {
    const r9k = el('div', 'tcx-tip__note');
    r9k.textContent = t('tip.badge.r9k', {
      percent: Math.round(model.r9kSimilarity * 100),
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

function statusHead(title, subtitle, status) {
  const header = head(title, subtitle);
  const red = ['surge', 'churn', 'lowEr', 'wave', 'suspicious'].includes(status);
  header.dataset.status = red ? 'alert' : status === 'ok' ? 'ok' : 'neutral';
  header.querySelector('.tcx-tip__dot').setAttribute('aria-hidden', 'true');
  return header;
}

function detailsSection(root) {
  const details = el('details', 'tcx-tip__details');
  details.appendChild(el('summary', '', t('tip.details')));
  root.appendChild(details);
  const list = el('div', 'tcx-tip__list');
  details.appendChild(list);
  return list;
}

function eventTime(ts) {
  return Number.isFinite(ts) ? new Intl.DateTimeFormat(getLocale(), {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(ts) : '';
}

function appendAnomaly(list, event, locale) {
  const number = (value) => formatNumber(value, locale);
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
  if (Number.isFinite(event.ts)) {
    block.appendChild(row(t('tip.eventTime'), eventTime(event.ts)));
  }
  if (outflow) {
    block.appendChild(el('div', 'tcx-tip__event-meta', t('tip.outflow.' + event.status, {
      time: eventTime(event.recoveredAt),
    })));
  }
  if (event.precedingDrop) {
    const drop = event.precedingDrop;
    block.appendChild(el('div', 'tcx-tip__event-meta', t('tip.precedingDrop', {
      values: number(drop.from) + ' → ' + number(drop.to),
      time: eventTime(drop.fromTs) + '–' + eventTime(drop.ts),
    })));
  }
  list.appendChild(block);
}

export function buildViewerTooltip(model) {
  const locale = getLocale();
  const number = (value) => formatNumber(value, locale);
  const root = el('div', 'tcx-tip tcx-tip--summary tcx-tip--viewer');
  const status = model.viewerStatus || 'waiting';
  root.appendChild(statusHead(t('tip.viewer.title'),
    t('tip.viewer.official', { value: number(model.official) }), status));

  const hero = el('div', 'tcx-tip__hero');
  const gathering = !model.range && !model.stale && status !== 'disconnected' &&
    model.loading && !model.loading.ready;
  if (model.range) {
    hero.appendChild(el('div', 'tcx-tip__hero-value tcx-tip__hero-value--range',
      number(model.range.low) + ' – ' + number(model.range.high)));
    hero.appendChild(el('div', 'tcx-tip__hero-caption',
      t('tip.estimate') + (model.sessionMs < 600000 ? ' · ' + t('tip.provisional') : '')));
  } else if (gathering) {
    hero.appendChild(el('div', 'tcx-tip__hero-value tcx-tip__hero-value--loading',
      t('tip.gathering', { percent: model.loading.percent })));
    for (const check of model.loading.checks.filter(({ weight, done }) => weight && !done)) {
      hero.appendChild(el('div', 'tcx-tip__loading-check', t('tip.missing.' + check.key, {
        value: number(check.value), required: number(check.required),
      })));
    }
  }
  if (hero.childElementCount) {
    root.appendChild(hero);
  }

  const list = el('div', 'tcx-tip__list');
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
  if (!model.stale && model.chatAlert && model.activeUsers) {
    list.appendChild(row(t('tip.chatAlertLabel'), t('tip.chatAlertValue', {
      suspicious: number(model.suspiciousUsers), active: number(model.activeUsers),
      threshold: model.threshold,
    })));
  }
  root.appendChild(list);
  const reasons = [t('tip.status.' + status)];
  if (!model.stale && model.engagement?.alert && status !== 'lowEr') {
    reasons.push(t('tip.status.lowEr'));
  }
  if (!gathering || status !== 'waiting') {
    root.appendChild(el('div', 'tcx-tip__status', reasons.join(' · ')));
  }

  if (Number.isFinite(model.stableOfficial)) {
    list.appendChild(row(t('tip.medianLabel'), number(model.stableOfficial)));
  }
  if (Number.isFinite(model.cleanUsers)) {
    list.appendChild(row(t('tip.viewer.clean'),
      t('tip.viewer.cleanValue', { clean: number(model.cleanUsers), active: number(model.activeUsers) })));
  }
  if (Number.isFinite(model.minute?.from) && Number.isFinite(model.minute?.to)) {
    list.appendChild(row(t('tip.viewer.minuteViewers'), number(model.minute.from) + ' → ' + number(model.minute.to)));
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
  if (model.range) {
    root.appendChild(el('div', 'tcx-tip__note', t('tip.estimateNote')));
  }
  return root;
}

export function buildStatsTooltip(model) {
  const locale = getLocale();
  const number = (value) => formatNumber(value, locale);
  const root = el('div', 'tcx-tip tcx-tip--summary');
  const status = model.chatStatus || 'waiting';
  root.appendChild(statusHead(t('stats.title'), t('stats.subtitle'), status));
  const list = el('div', 'tcx-tip__list');
  list.appendChild(row(t('stats.activeLabel'), number(model.activeUsers)));
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

// Keep the scroll container and disclosure control mounted during live updates.
function updateTooltipContent(current, next) {
  if (current.isEqualNode(next)) {
    return;
  }
  if (next.hasAttribute('data-status')) {
    current.dataset.status = next.dataset.status;
  }
  if (!next.childElementCount && !current.childElementCount) {
    if (current.textContent !== next.textContent) {
      current.textContent = next.textContent;
    }
    return;
  }

  const key = (node) => node.classList.contains('tcx-tip__row')
    ? node.firstElementChild.textContent
    : node.className || node.tagName;
  const existing = Array.from(current.children);
  let position = current.firstElementChild;
  for (const incoming of Array.from(next.children)) {
    const index = existing.findIndex((node) => key(node) === key(incoming));
    const node = index === -1 ? incoming : existing.splice(index, 1)[0];
    if (node !== incoming) {
      updateTooltipContent(node, incoming);
    }
    if (node !== position) {
      current.insertBefore(node, position);
    }
    position = node.nextElementSibling;
  }
  for (const node of existing) {
    node.remove();
  }
}

export class TooltipController {
  constructor() {
    this.instances = new WeakMap();
  }

  attach(element, contentFactory, { interactive = false, disclosure } = {}) {
    if (!element) {
      return null;
    }

    this.detach(element);
    element.removeAttribute('title');

    const content = contentFactory();
    if (interactive) {
      content.tabIndex = 0;
    }
    const details = content.querySelector('details');
    if (details && disclosure) {
      details.open = disclosure.open;
    }
    const update = (instance) => {
      if (interactive) {
        updateTooltipContent(content, contentFactory());
        instance.popperInstance?.update();
      } else {
        instance.setContent(contentFactory());
      }
    };
    const instance = tippy(element, {
      content,
      onShow: update,
      theme: 'twitch',
      placement: 'top-start',
      trigger: 'mouseenter focus',
      delay: [90, 50],
      duration: [130, 80],
      maxWidth: 360,
      interactive,
      role: interactive ? 'dialog' : 'tooltip',
      hideOnClick: true,
      animation: 'fade',
      appendTo: () => document.body,
      zIndex: 100000,
      popperOptions: {
        modifiers: [
          { name: 'preventOverflow', options: { padding: 10 } },
          { name: 'flip', options: { padding: 10 } },
        ],
      },
    });

    details?.addEventListener('toggle', () => instance.popperInstance?.update());

    const onKey = (event) => {
      if (event.key === 'Escape' && instance.state.isVisible) {
        element.focus({ preventScroll: true });
        instance.hide();
      } else if (event.currentTarget === element && !event.shiftKey &&
          (event.key === 'Tab' || event.key === 'ArrowDown') && instance.state.isVisible) {
        event.preventDefault();
        (content.querySelector('summary') || content).focus();
      }
    };
    if (interactive) {
      element.addEventListener('keydown', onKey);
      instance.popper.addEventListener('keydown', onKey);
    }
    this.instances.set(element, { instance, update, onKey, details, disclosure });
    return instance;
  }

  refresh(element) {
    const record = this.instances.get(element);
    if (record && record.instance.state && record.instance.state.isVisible) {
      record.update(record.instance);
    }
  }

  detach(element) {
    if (!element) {
      return;
    }
    const record = this.instances.get(element);
    if (record) {
      if (record.details && record.disclosure) {
        record.disclosure.open = record.details.open;
      }
      element.removeEventListener('keydown', record.onKey);
      record.instance.destroy();
      this.instances.delete(element);
    }
  }
}

export const tooltipController = new TooltipController();
