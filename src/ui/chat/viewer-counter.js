/*
 * Twitch Chat X-Ray — Real Viewers Counter.
 *
 * Keeps Twitch's official viewer number untouched and appends an estimated
 * live range in parentheses, e.g. `56 090 (≈8–12,5 тыс.)`.
 *
 * A new user has no idea what the parentheses contain, and before the chat
 * sample is big enough there is no range at all. So while the estimate is
 * loading the counter says so explicitly — `(Загружаю… 66%)` for Russian and
 * `(Loading… 66%)` for English — and the percentage is the progress of the
 * same gates the estimate uses (observation time, clean chatters, messages).
 * Once the range exists it is shown instead of the percentage.
 *
 * The counter highlights recent movements in online viewers and low engagement.
 *
 * The estimate is built from clean unique chatters, not from the share of
 * suspicious chatters: viewbots watch the stream without joining IRC, so a
 * 20% bot share in chat does not mean 20% of the official number is fake.
 * The official number is also sampled over time so bot churn (50k → 40k → 50k)
 * is detected and the smoothed median is used instead of the jumping value.
 */
import {
  formatNumber,
  formatViewerRangeCompact,
  setAttributeIfChanged,
  setTextIfChanged,
} from '../shared/ui-utils.js';
import { buildViewerModel } from '../../analysis/viewer-estimate.js';
import { ViewerHistory } from '../../analysis/viewer-history.js';
import { ErSessionTracker } from '../../analysis/er-baseline.js';
import {
  buildViewerTooltip,
  tooltipController,
} from '../shared/tooltip-controller.js';
import { formatPercent, getLocale, t } from '../../i18n/i18n.js';

const VIEWER_COUNT_SELECTORS = [
  '[data-a-target="animated-channel-viewers-count"]',
  '.live-channel-metadata-bar [data-a-target$="-viewers-count"]',
  '[data-test-selector="channel-viewers-count"]',
];

const MULTIPLIERS = {
  k: 1000,
  к: 1000,
  тыс: 1000,
  'тыс.': 1000,
  m: 1000000,
  м: 1000000,
  млн: 1000000,
  'млн.': 1000000,
  million: 1000000,
};

export function parseTwitchViewerCount(rawText) {
  if (typeof rawText !== 'string') {
    return null;
  }

  let text = rawText
    .replace(/[\u00A0\u2009\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^[~≈+]+\s*/, '');

  if (!text) {
    return null;
  }

  text = text.replace(/\s*(?:зрител[а-яё]*|viewers?)\s*$/iu, '').trim();

  const match = text.match(
    /^([\d.,\s]+?)\s*(k|к|тыс\.?|m|м|млн\.?|million)?$/i
  );
  if (!match) {
    return null;
  }

  let numberPart = match[1].replace(/\s+/g, '');
  if (!/\d/.test(numberPart)) {
    return null;
  }

  const suffix = match[2] ? match[2].toLowerCase() : '';
  if (suffix) {
    numberPart = numberPart.replace(',', '.');
    const base = Number.parseFloat(numberPart);
    const multiplier = MULTIPLIERS[suffix];
    if (!Number.isFinite(base) || !multiplier) {
      return null;
    }
    return Math.round(base * multiplier);
  }

  const value = Number.parseInt(numberPart.replace(/[.,]/g, ''), 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function formatViewerRange(range, locale) {
  if (!range) {
    return '';
  }
  const resolved = locale || getLocale();
  return `${formatNumber(range.low, resolved)} – ${formatNumber(
    range.high,
    resolved
  )}`;
}

/**
 * Text inside the parentheses. Loading beats the range on purpose: while the
 * sample is short the range would be a wild guess, and the loading word shows
 * the state so a new user understands something is running.
 *
 * While loading the result is split into three parts — prefix, word, percent —
 * so the shown text reads "Загружаю… 66%": the animated ellipsis belongs after
 * the word (not after the counter) and the percentage stays last and still.
 */
export function buildCounterParts(model) {
  const loading = model.loading;
  if (loading && !loading.ready) {
    return {
      loading: true,
      prefix: ' (',
      word: t('counter.loading'),
      suffix: '…',
      percent: loading.percent + '%',
    };
  }
  const text = model.range
    ? ` (≈${formatViewerRangeCompact(model.range, getLocale())})`
    : ` (${t('counter.loading')}…)`;
  return { loading: false, text };
}

function counterAria(model) {
  const locale = getLocale();
  const parts = [];
  if (model.loading && !model.loading.ready) {
    const checks = model.loading.checks
      .filter((check) => check.weight > 0)
      .map((check) =>
        t(`counter.check.${check.key}`, {
          value: formatNumber(check.value, locale),
          minutes: check.value,
          required: check.required,
        })
      );
    parts.push(
      t('counter.aria', {
        percent: model.loading.percent,
        done: model.loading.done,
        required: model.loading.required,
        checks: checks.join(', '),
      })
    );
  }

  if (model.range) {
    parts.push(t('viewer.rangeAria', { range: formatViewerRange(model.range) }));
  } else if (model.loading && model.loading.ready) {
    parts.push(t('viewer.noRange'));
  }
  parts.push(t('viewer.official', { value: formatNumber(model.official) }));
  if (model.engagement) {
    parts.push(
      t('viewer.engagement', {
        percent: formatPercent(model.engagement.percent, locale),
      })
    );
  }
  if (model.viewerStatus) {
    parts.push(t('tip.status.' + model.viewerStatus));
  }
  return parts.join(' ');
}

export class ViewerCounterAdjuster {
  constructor(options) {
    this.getStats = options.getStats;
    this.getSettings = options.getSettings;
    this.getMinute = options.getMinute || (() => null);
    this.countMessages = options.countMessages;
    this.onSample = options.onSample;
    this.onModel = options.onModel;
    this.lastModel = null;
    this.history = new ViewerHistory(
      Object.assign({ warmupMs: 8000 }, options.viewerHistory || {})
    );
    this.baselineStore = options.baselineStore || null;
    this.channel = String(options.channel || '').toLowerCase();
    this.threshold = 0;
    this.tracker = null;
    this.settleMs = Number(options.settleMs) || 8000;
    this.settleUntil = 0;
    this.el = null;
    this.targetNode = null;
    this.model = null;
    this.lastText = '';
  }

  update(channel) {
    const now = Date.now();
    if (channel !== undefined && channel !== this.channel) {
      this.channel = String(channel || '').toLowerCase();
      this.reset(this.channel);
    }

    const settings = this.getSettings();
    if (!settings.adjustViewerCounter && !settings.recordSession) {
      this.remove();
      return;
    }

    // Twitch keeps the previous channel's header (and viewer count) mounted
    // for a moment while the SPA swaps pages. Sampling that number would look
    // like an enormous rollback on the new channel, so stay quiet until the
    // new page has settled.
    if (now < this.settleUntil) {
      this.remove();
      return;
    }

    const target = this._findViewerCountElement();
    if (!target) {
      this.showLastMeasurement(settings, now);
      return;
    }

    const twitchViewers = parseTwitchViewerCount(target.textContent || '');
    if (twitchViewers === null) {
      this.showLastMeasurement(settings, now);
      return;
    }

    // Every maintenance tick samples the official number; the history keeps a
    // bounded timeline and finds drop-and-refill cycles.
    const stats = this.getStats(now);
    const threshold = Number(settings.suspiciousThreshold) || 0;
    if (!this.tracker || this.tracker.threshold !== threshold) {
      this.finishTracker(now);
      this.tracker = this.baselineStore
        ? new ErSessionTracker({
            channel: this.channel,
            threshold,
            store: this.baselineStore,
          })
        : null;
      this.threshold = threshold;
    }

    const accepted = this.history.record(twitchViewers, now, {
      cleanUsers: stats.cleanUsers,
      countMessages: this.countMessages,
    });
    if (accepted) {
      this.onSample?.(accepted);
    }
    if (this.tracker && stats.sessionMs >= 600000) {
      this.tracker.observe(
        twitchViewers,
        stats.cleanUsers,
        stats.sessionMs,
        now
      );
    }

    const modelInput = {
      official: twitchViewers,
      minute: this.getMinute(now, this.history.samples, stats),
      stats,
      history: this.history.getStats(now),
      baseline: this.tracker ? this.tracker.getBaseline() : null,
    };
    const model = buildViewerModel(modelInput);

    if (!model) {
      this.remove();
      return;
    }
    model.threshold = threshold;
    model.sampledAt = now;
    model.input = modelInput;
    model.observationMs = stats.observationMs;
    model.chatAlert = stats.chatConnected !== false && (stats.waveAlert ||
      (stats.suspiciousShare > 0 && stats.suspiciousShare * 100 >= threshold));
    model.viewerStatus = model.churn.lastAnomaly &&
      now - model.churn.lastAnomaly.ts < this.history.options.churnWindowMs
      ? model.churn.lastAnomaly.kind
      : model.engagement?.alert ? 'lowEr'
        : stats.chatConnected === false ? 'disconnected'
          : model.engagement?.measurable && model.range ? 'ok' : 'waiting';
    this.lastModel = model;
    this.onModel?.(model);

    if (settings.adjustViewerCounter) {
      this._render(target, model);
    } else {
      this.remove();
      this.model = model;
    }
  }

  showLastMeasurement(settings, now) {
    const last = this.history.samples.at(-1);
    if (last && now - last.ts > this.history.options.maxGapMs) {
      this.history.interrupt(last.ts + this.history.options.maxGapMs);
    }
    if (!settings.adjustViewerCounter || !this.lastModel) {
      this.remove();
      return;
    }
    const target = this.targetNode?.isConnected ? this.targetNode
      : document.querySelector('[data-tcx-ui="stats"]');
    if (target) {
      const { lastOutflow } = this.history.getStats(now);
      const churn = { ...this.lastModel.churn, lastOutflow };
      this._render(target, { ...this.lastModel, churn, stale: true, viewerStatus: 'stale' });
    } else {
      this.remove();
    }
  }

  finishTracker(now) {
    if (this.tracker) {
      this.tracker.finish(now);
      this.tracker = null;
    }
  }

  /**
   * Channel change: persist the finished session's ER baseline, drop the old
   * viewer timeline and wait for Twitch to render the new channel.
   */
  reset(channel) {
    if (channel !== undefined) {
      this.channel = String(channel || '').toLowerCase();
    }
    this.finishTracker(Date.now());
    this.remove();
    this.history.reset();
    this.lastModel = null;
    this.settleUntil = Date.now() + this.settleMs;
  }

  /** Called on pagehide so a closed tab still contributes its ER baseline. */
  finish() {
    this.finishTracker(Date.now());
  }

  remove() {
    if (this.el) {
      tooltipController.detach(this.el);
      this.el.remove();
    }
    this.el = null;
    this.targetNode = null;
    this.model = null;
    this.lastText = '';
  }

  _findViewerCountElement() {
    for (const selector of VIEWER_COUNT_SELECTORS) {
      const node = document.querySelector(selector);
      if (node && node.isConnected && node.textContent) {
        return node;
      }
    }
    return null;
  }

  _render(target, model) {
    if (!this.el || !this.el.isConnected || this.targetNode !== target) {
      this.remove();
      this.el = document.createElement('span');
      this.el.className = 'tcx-real-viewers';
      this.el.dataset.tcxUi = 'real-viewers';
      this.el.tabIndex = 0;
      this.targetNode = target;
      this.model = model;

      if (target.parentNode) {
        target.parentNode.insertBefore(this.el, target.nextSibling);
      }

      tooltipController.attach(this.el, () => buildViewerTooltip(this.model), { interactive: true });
    }

    this.model = model;

    const loading = !model.stale && Boolean(model.loading && !model.loading.ready);
    const alertState = ['churn', 'surge', 'lowEr'].includes(model.viewerStatus);

    this._renderText(model, loading);

    this.el.classList.toggle('tcx-real-viewers--alert', alertState);
    this.el.classList.toggle('tcx-real-viewers--loading', loading);
    this.el.classList.toggle('tcx-real-viewers--nodata', !model.range && !loading);
    this.el.dataset.tcxState = alertState ? 'alert' : loading ? 'loading' : model.viewerStatus;
    this.el.dataset.tcxPercent = String(
      model.loading ? model.loading.percent : 100
    );

    setAttributeIfChanged(this.el, 'aria-label', model.stale ? t('tip.status.stale') : counterAria(model));
    tooltipController.refresh(this.el);
  }

  /**
   * Write the parentheses text.
   *
   * Loading state is rendered as nested spans: the dots hang off the word
   * ("Загружаю…") and the percentage comes last, so the digits never shift and
   * the dots never appear after the "%". Both states are written through
   * setTextIfChanged on their own nodes, so an unchanged value never produces
   * a DOM write the page MutationObserver could react to.
   */
  _renderText(model, loading) {
    const parts = model.stale ? { text: t('tip.status.stale') } : buildCounterParts(model);

    if (!parts.loading) {
      const text = parts.text;
      if (this.lastHtml) {
        this.el.textContent = '';
        this.lastHtml = false;
      }
      setTextIfChanged(this.el, text);
      this.lastText = text;
      return;
    }

    const signature = parts.word + '|' + parts.percent;
    if (this.lastHtml && this.textRefs && signature === this.lastText) {
      return;
    }

    if (!this.textRefs || !this.lastHtml) {
      this.el.textContent = '';
      const prefix = document.createTextNode(parts.prefix);
      const word = document.createElement('span');
      word.className = 'tcx-real-viewers__word';
      word.textContent = parts.word;
      const percent = document.createElement('span');
      percent.className = 'tcx-real-viewers__percent';
      percent.textContent = parts.percent;
      const close = document.createTextNode(')');
      this.el.appendChild(prefix);
      this.el.appendChild(word);
      this.el.appendChild(document.createTextNode(' '));
      this.el.appendChild(percent);
      this.el.appendChild(close);
      this.textRefs = { word, percent };
      this.lastHtml = true;
    } else {
      setTextIfChanged(this.textRefs.word, parts.word);
      setTextIfChanged(this.textRefs.percent, parts.percent);
    }

    this.lastText = signature;
  }
}
