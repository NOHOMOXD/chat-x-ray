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
import { formatPercent, getLocale, pluralForm, t } from '../../i18n/i18n.js';
import { verdictLabel } from '../../analysis/viewer-estimate.js';

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

export function buildBadgeTooltip(model) {
  const root = el('div', 'tcx-tip');
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

/** Pick the plural form of a catalogue word ("rollback"/"откат"). */
function pluralWord(key, number) {
  return t(`tip.viewer.${key}.${pluralForm(getLocale(), number)}`);
}

export function buildViewerTooltip(model) {
  const locale = getLocale();
  const root = el('div', 'tcx-tip');
  root.classList.add('tcx-tip--viewer');

  const level = model.verdict ? model.verdict.level : 'ok';
  root.classList.add('tcx-tip--' + level);

  const subtitle = [
    t('tip.viewer.official', {
      value: formatNumber(model.official, locale),
    }),
  ];
  if (
    Number.isFinite(model.stableOfficial) &&
    Math.abs(model.stableOfficial - model.official) >= 100
  ) {
    subtitle.push(
      t('tip.viewer.median', {
        value: formatNumber(model.stableOfficial, locale),
      })
    );
  }
  root.appendChild(head(t('tip.viewer.title'), subtitle.join(' · '), null));

  const hero = el('div', 'tcx-tip__hero');
  if (model.range) {
    const value = el(
      'div',
      'tcx-tip__hero-value tcx-tip__hero-value--range',
      `${formatNumber(model.range.low, locale)} – ${formatNumber(
        model.range.high,
        locale
      )}`
    );
    hero.appendChild(value);
    hero.appendChild(el('div', 'tcx-tip__hero-caption', t('tip.viewer.heroRange')));
  } else {
    hero.appendChild(el('div', 'tcx-tip__hero-value', '—'));
    hero.appendChild(el('div', 'tcx-tip__hero-caption', t('tip.viewer.heroEmpty')));
  }
  root.appendChild(hero);

  const list = el('div', 'tcx-tip__list');
  const engagement = model.engagement;
  if (engagement) {
    const alert = Boolean(engagement.alert);
    const baseline = model.erBaseline;
    const baselineSuffix =
      baseline && Number.isFinite(baseline.er)
        ? t('tip.viewer.erUsually', {
            percent: formatPercent(baseline.er, locale),
          })
        : '';
    list.appendChild(
      row(
        engagement.measurable
          ? t('tip.viewer.er')
          : t('tip.viewer.erProvisional'),
        `${formatPercent(engagement.percent, locale)}${alert ? ' ⚠' : ''}${baselineSuffix}`,
        {
          className: alert
            ? 'tcx-tip__value tcx-tip__value--alert'
            : engagement.measurable
              ? 'tcx-tip__value'
              : 'tcx-tip__value tcx-tip__value--muted',
        }
      )
    );
  }
  list.appendChild(
    row(
      t('tip.viewer.clean'),
      t('tip.viewer.cleanValue', {
        clean: model.cleanUsers,
        active: model.activeUsers,
      })
    )
  );
  list.appendChild(
    row(
      t('tip.viewer.tempo'),
      t('tip.viewer.tempoValue', { value: model.messagesPerMinute })
    )
  );
  const suspiciousShare = model.activeUsers
    ? Math.round((model.suspiciousUsers / model.activeUsers) * 100)
    : 0;
  list.appendChild(
    row(
      t('tip.viewer.suspicious'),
      t('tip.viewer.suspiciousValue', {
        users: model.suspiciousUsers,
        percent: suspiciousShare,
      }),
      {
        className:
          suspiciousShare >= Number(model.threshold || 0)
            ? 'tcx-tip__value tcx-tip__value--alert'
            : 'tcx-tip__value',
      }
    )
  );
  if (model.freshUsers > 0) {
    list.appendChild(row(t('tip.viewer.fresh'), `${model.freshUsers}`));
  }

  const loading = model.loading;
  if (loading && !loading.ready) {
    list.appendChild(
      row(
        t('tip.viewer.loading'),
        t('tip.viewer.loadingValue', { percent: loading.percent }),
        { className: 'tcx-tip__value tcx-tip__value--loading' }
      )
    );
  }

  const churn = model.churn;
  const totalChurn = churn
    ? churn.totalChurnEvents !== undefined
      ? churn.totalChurnEvents
      : churn.churnEvents
    : 0;
  if (churn && totalChurn > 0) {
    list.appendChild(
      row(
        t('tip.viewer.churn'),
        t('tip.viewer.churnValue', {
          count: totalChurn,
          word: pluralWord('churnWord', totalChurn, locale),
          avg: formatNumber(churn.averageDrop || 0, locale),
        }),
        {
          className: churn.churnActive
            ? 'tcx-tip__value tcx-tip__value--alert'
            : 'tcx-tip__value',
        }
      )
    );
    if (
      Number.isFinite(churn.churnRecent) &&
      churn.churnRecent !== totalChurn
    ) {
      list.appendChild(
        row(t('tip.viewer.churnRecent'), `${churn.churnRecent}`, {
          className: 'tcx-tip__value tcx-tip__value--muted',
        })
      );
    }
    const samples = churn.dropSamples || [];
    if (samples.length) {
      root.appendChild(
        el(
          'div',
          'tcx-tip__note tcx-tip__note--drops',
          t('tip.viewer.drops', {
            list: samples
              .map((drop) => `−${formatNumber(drop, locale)}`)
              .join(' · '),
          })
        )
      );
    }
    const event = churn.lastEvent;
    if (
      event &&
      Number.isFinite(event.from) &&
      Number.isFinite(event.low)
    ) {
      const parts = [
        `${formatNumber(event.from, locale)} → ${formatNumber(event.low, locale)}`,
      ];
      if (Number.isFinite(event.erBefore) && Number.isFinite(event.erAfter)) {
        parts.push(
          `ER ${formatPercent(event.erBefore, locale)} → ${formatPercent(
            event.erAfter,
            locale
          )}`
        );
      }
      root.appendChild(
        el(
          'div',
          'tcx-tip__note tcx-tip__note--last-drop',
          t('tip.viewer.lastDrop', { parts: parts.join(' · ') })
        )
      );
    }
  } else if (churn && churn.pendingDrop) {
    list.appendChild(
      row(
        t('tip.viewer.churn'),
        t('tip.viewer.pendingDrop', {
          drop: formatNumber(churn.pendingDrop.drop, locale),
        }),
        { className: 'tcx-tip__value tcx-tip__value--muted' }
      )
    );
  } else if (churn && churn.volatility >= 0.08) {
    list.appendChild(
      row(
        t('tip.viewer.volatility'),
        `${Math.round(churn.volatility * 100)}%`,
        { className: 'tcx-tip__value tcx-tip__value--muted' }
      )
    );
  }

  if (model.isBotWave) {
    list.appendChild(
      row(t('tip.viewer.wave'), t('tip.viewer.waveYes'), {
        className: 'tcx-tip__value tcx-tip__value--alert',
      })
    );
  }

  const minutes = Math.max(0, Math.round(model.sessionMs / 60000));
  const confidenceKey =
    'tip.viewer.confidence.' +
    (model.range ? model.range.confidence : 'low');
  list.appendChild(
    row(
      t('tip.viewer.window'),
      t('tip.viewer.windowValue', {
        minutes,
        confidence: t(confidenceKey),
      }),
      { className: 'tcx-tip__value tcx-tip__value--muted' }
    )
  );
  root.appendChild(list);

  if (model.verdict) {
    root.appendChild(
      el(
        'div',
        `tcx-tip__verdict tcx-tip__verdict--${level}`,
        verdictLabel(model.verdict, t)
      )
    );
  }

  if (model.range) {
    root.appendChild(el('div', 'tcx-tip__note', t('tip.viewer.note')));
  }

  const footer = el('div', 'tcx-tip__foot');
  footer.textContent = t('tip.viewer.foot');
  root.appendChild(footer);
  return root;
}

export function buildStatsTooltip(model) {
  const root = el('div', 'tcx-tip');
  root.appendChild(head(t('stats.title'), t('stats.subtitle'), null));

  const list = el('div', 'tcx-tip__list');
  list.appendChild(
    row(t('stats.mpmLabel'), `${model.messagesPerMinute} ${t('stats.mpm')}`)
  );
  list.appendChild(
    row(
      t('stats.activeLabel'),
      t('stats.activeValue', {
        value: model.activeUsers,
        clean: model.cleanUsers,
      })
    )
  );
  list.appendChild(
    row(
      t('stats.suspiciousLabel'),
      `${model.suspiciousPercent}%`,
      {
        className:
          model.alertState
            ? 'tcx-tip__value tcx-tip__value--alert'
            : 'tcx-tip__value',
      }
    )
  );
  list.appendChild(
    row(
      t('stats.window'),
      t('stats.windowValue', { value: model.windowMessages })
    )
  );
  if (model.loading && !model.loading.ready) {
    list.appendChild(
      row(
        t('stats.loadingTip', { percent: model.loading.percent }),
        `${model.loading.done}/${model.loading.required}`,
        { className: 'tcx-tip__value tcx-tip__value--loading' }
      )
    );
  }
  if (model.isBotWave) {
    list.appendChild(
      row(t('tip.viewer.wave'), t('tip.viewer.waveYes'), {
        className: 'tcx-tip__value tcx-tip__value--alert',
      })
    );
  }
  if (model.auditLogCount) {
    list.appendChild(row(t('stats.audit'), model.auditLogCount));
  }
  root.appendChild(list);

  const footer = el('div', 'tcx-tip__foot');
  footer.textContent = t('stats.foot');
  root.appendChild(footer);
  return root;
}

export class TooltipController {
  constructor() {
    this.instances = new WeakMap();
  }

  attach(element, contentFactory) {
    if (!element) {
      return null;
    }

    this.detach(element);
    element.removeAttribute('title');

    const instance = tippy(element, {
      content() {
        return contentFactory();
      },
      onShow(instance) {
        // Tippy caches the initial content node. Rebuild it so live values
        // (score, viewer estimate, stats) are current every time it opens.
        instance.setContent(contentFactory());
      },
      theme: 'twitch',
      placement: 'top-start',
      trigger: 'mouseenter focus',
      delay: [90, 50],
      duration: [130, 80],
      maxWidth: 360,
      interactive: false,
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

    this.instances.set(element, { instance, contentFactory });
    return instance;
  }

  refresh(element) {
    const record = this.instances.get(element);
    if (record && record.instance.state && record.instance.state.isVisible) {
      record.instance.setContent(record.contentFactory());
    }
  }

  detach(element) {
    if (!element) {
      return;
    }
    const record = this.instances.get(element);
    if (record) {
      record.instance.destroy();
      this.instances.delete(element);
    }
  }
}

export const tooltipController = new TooltipController();
