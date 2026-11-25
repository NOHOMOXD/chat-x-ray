/*
 * Twitch Chat X-Ray — Real Viewers Counter.
 *
 * Keeps Twitch's official viewer number untouched and appends an estimated
 * live range in parentheses, e.g. `56 090 (≈8–12,5 тыс.)`.
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
  formatViewerRange,
  formatViewerRangeCompact,
  setAttributeIfChanged,
  setTextIfChanged,
} from '../shared/ui-utils.js';
import { modeProfile } from '../../platform/chat-mode.js';
import { MAX_OBSERVATION_GAP } from '../../analysis/observation-clock.js';
import { broadcastProfile } from '../../analysis/broadcast-history.js';
import { buildViewerModel } from '../../analysis/viewer-estimate.js';
import { ViewerHistory } from '../../analysis/viewer-history.js';
import {
  buildViewerTooltip,
  tooltipController,
} from '../shared/tooltip-controller.js';
import { getLocale, t } from '../../i18n/i18n.js';

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

export { formatViewerRange };

export function buildCounterParts(model) {
  const locale = getLocale();
  if (model.range) {
    const range = formatViewerRangeCompact(model.range, locale, model.official);
    return { text: model.recentAge != null
      ? ' · ' + t('viewer.recent', { range, age: model.recentAge }) : ' (≈' + range + ')' };
  }
  const count = model.observedChatters || 0;
  if (count) return { text: ' · ' + formatNumber(count, locale) + ' ' +
    t('viewer.' + new Intl.PluralRules(locale).select(count)) };
  const event = model.waveCount ? 'wave' : model.churn?.lastOutflow ? 'outflow' : model.churn?.totalSurges ? 'surge' : null;
  return { text: event ? ' · ' + t('tip.status.' + event) : '' };
}

export class ViewerCounterAdjuster {
  constructor(options) {
    this.getStats = options.getStats;
    this.getBroadcast = options.getBroadcast || (() => null);
    this.getSaved = options.getSaved || (() => null);
    this.getSettings = options.getSettings;
    this.getMinute = options.getMinute || (() => null);
    this.countMessages = options.countMessages;
    this.onSample = options.onSample;
    this.onModel = options.onModel;
    this.lastModel = null;
    this.history = new ViewerHistory(
      Object.assign({ warmupMs: 8000 }, options.viewerHistory || {})
    );
    this.getBaseline = options.getBaseline || (() => null);
    this.isPaused = options.isPaused || (() => false);
    this.onMissing = options.onMissing || (() => {});
    this.channel = String(options.channel || '').toLowerCase();
    this.threshold = 0;
    this.settleMs = Number(options.settleMs) || 8000;
    this.settleUntil = 0;
    this.el = null;
    this.targetNode = null;
    this.model = null;
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
      const stats = this.getStats(now);
      const target = this._findViewerCountElement();
      const observedChatters = Math.max(0, stats.activeUsers - stats.serviceBots);
      if (settings.adjustViewerCounter && target && observedChatters) {
        this._render(target, { observedChatters, audienceMessages: stats.audienceMessages, viewerStatus: 'waiting' });
      } else this.remove();
      return;
    }

    const target = this._findViewerCountElement();
    if (!target) {
      this.onMissing(now);
      this.showLastMeasurement(settings, now);
      return;
    }

    const twitchViewers = parseTwitchViewerCount(target.textContent || '');
    if (twitchViewers === null) {
      this.onMissing(now);
      this.showLastMeasurement(settings, now);
      return;
    }

    // Every maintenance tick samples the official number; the history keeps a
    // bounded timeline and finds drop-and-refill cycles.
    const stats = this.getStats(now);
    const threshold = Number(settings.suspiciousThreshold) || 0;
    this.threshold = threshold;
    if (this.isPaused()) {
      this.showLastMeasurement(settings, now);
      return;
    }

    const accepted = this.history.record(twitchViewers, now, {
      cleanUsers: stats.cleanUsers,
      countMessages: this.countMessages,
    });
    if (accepted) {
      this.onSample?.(accepted);
    }
    if (stats.chatConnected === false && stats.chatAccess !== 'unknown' &&
        (this.lastModel?.chatConnected || this.lastModel?.engagement?.measurable)) {
      this.showLastMeasurement(settings, now);
      return;
    }
    const modelInput = {
      official: twitchViewers,
      minute: this.getMinute(now, this.history.samples, stats),
      stats,
      history: this.history.getStats(now),
      baseline: this.getBaseline(),
    };
    const model = buildViewerModel(modelInput);

    if (!model) {
      this.remove();
      return;
    }
    model.threshold = threshold;
    model.historyProfile = broadcastProfile({ ...settings, roomProfile: modeProfile(stats.roomMode) });
    model.chatConnected = stats.chatConnected !== false;
    model.sampledAt = now;
    model.input = modelInput;
    model.observationMs = stats.observationMs;
    model.chatAlert = stats.chatConnected !== false && (stats.waveAlert ||
      (stats.suspiciousShare > 0 && stats.suspiciousShare * 100 >= threshold));
    model.viewerStatus = model.churn.lastAnomaly &&
      now - model.churn.lastAnomaly.ts < this.history.options.churnWindowMs
      ? model.churn.lastAnomaly.kind
      : stats.waveAlert ? 'wave'
          : model.churn.lastOutflow?.status === 'observing' ? 'outflow'
          : model.engagement?.alert ? 'lowEr'
          : stats.chatConnected === false ? 'disconnected'
          : model.engagement?.measurable && model.range ? 'ok' : 'waiting';
    this.lastModel = model;
    this.onModel?.(model);

    if (settings.adjustViewerCounter) {
      this.renderMeasurement(target, model, now);
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
    const target = this._findViewerCountElement();
    if (!target) return this.remove();
    const stats = this.getStats(now);
    this.renderMeasurement(target, { ...this.lastModel, range: null, engagement: null,
      observedChatters: Math.max(0, stats.activeUsers - stats.serviceBots) || 0,
      audienceMessages: stats.audienceMessages, waveCount: stats.waveCount,
      churn: this.history.getStats(now),
      historyProfile: broadcastProfile({ ...settings, roomProfile: modeProfile(stats.roomMode) }),
      viewerStatus: 'disconnected' }, now);
  }

  renderMeasurement(target, model, now) {
    const identity = this.getBroadcast();
    if (identity && model.range) this.recent = { identity, model };
    if (identity && !model.range) {
      const saved = [this.recent?.identity === identity && this.recent.model, this.getSaved()]
        .filter(item => item?.range && item.historyProfile === model.historyProfile &&
          item.sampledAt <= now && now - item.sampledAt <= MAX_OBSERVATION_GAP)
        .sort((a, b) => b.sampledAt - a.sampledAt)[0];
      if (saved) model = { ...model, range: saved.range, recentAge: Math.floor((now - saved.sampledAt) / 1000) };
    }
    if (!buildCounterParts(model).text) {
      this.remove();
      this.model = model;
      return;
    }
    this._render(target, model);
  }

  reset(channel) {
    if (channel !== undefined) {
      this.channel = String(channel || '').toLowerCase();
    }
    this.remove();
    this.recent = null;
    this.history.reset();
    this.lastModel = null;
    this.settleUntil = Date.now() + this.settleMs;
  }

  remove() {
    if (this.el) {
      tooltipController.detach(this.el);
      this.el.remove();
    }
    this.el = null;
    this.targetNode = null;
    this.model = null;
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

    const { text } = buildCounterParts(model);
    setTextIfChanged(this.el, text);
    const alert = ['churn', 'surge', 'lowEr', 'outflow', 'wave'].includes(model.viewerStatus);
    this.el.classList.toggle('tcx-real-viewers--alert', alert);
    this.el.dataset.tcxState = alert ? 'alert' : model.recentAge != null ? 'recent' : model.range ? 'range' : 'activity';
    setAttributeIfChanged(this.el, 'aria-label', text.trim());
    tooltipController.refresh(this.el);
  }
}
