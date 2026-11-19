/*
 * Twitch Chat X-Ray — live summary strip view.
 * Mounts between Twitch's .stream-chat-header and .chat-room.
 * Uses selective text updates to prevent MutationObserver feedback loops.
 *
 * The strip can be hidden from settings ("Show the stats strip above chat");
 * while the viewer estimate is still gathering its sample the strip shows
 * "Загружаю… 66%" / "Loading… 66%" so the percentage is visible without the
 * tooltip, and any bot wave turns the strip red.
 */
import { isAlertState, setAttributeIfChanged, setTextIfChanged } from '../shared/ui-utils.js';
import {
  buildStatsTooltip,
  tooltipController,
} from '../shared/tooltip-controller.js';
import { getLocale, t } from '../../i18n/i18n.js';
import { getLoadingProgress } from '../../analysis/viewer-estimate.js';

const EMPTY_STATS = Object.freeze({
  messagesPerMinute: 0,
  activeUsers: 0,
  cleanUsers: 0,
  suspiciousPercent: 0,
  suspiciousShare: 0,
  windowMessages: 0,
  auditLogCount: 0,
  isBotWave: false,
  sessionMs: 0,
});

export class StatsView {
  constructor(options) {
    this.getStats = options.getStats;
    this.getSettings = options.getSettings || (() => ({ showChatStats: true }));
    this.el = null;
    this.refs = null;
    this.container = null;
    this.stats = null;
    this.loading = null;
    this.alertState = false;
    this.disclosure = { open: false };
  }

  get hidden() {
    const settings = this.getSettings() || {};
    return settings.showChatStats === false;
  }

  ensure(container) {
    if (!container || this.hidden) {
      this.remove();
      return;
    }
    if (this.el && this.el.isConnected && this.container === container) {
      return;
    }

    this.remove();
    const placement = this._resolveHost(container);
    if (!placement || !placement.host) {
      return;
    }

    const plate = this._create();
    plate.classList.toggle('tcx-stats--sticky', placement.sticky);
    try {
      if (placement.before && placement.before.parentNode === placement.host) {
        placement.host.insertBefore(plate, placement.before);
      } else {
        placement.host.insertBefore(plate, placement.host.firstChild);
      }
    } catch (_error) {
      return;
    }

    this.el = plate;
    this.container = container;
    this.update();
  }

  remove() {
    if (this.el) {
      tooltipController.detach(this.el);
      this.el.remove();
    }
    this.el = null;
    this.refs = null;
    this.container = null;
    this.stats = null;
  }

  /** Re-read the language after a settings change. */
  refreshLabels() {
    if (!this.el) {
      return;
    }
    const refs = this.refs;
    // Keep the accessibility language in sync with the rendered text.
    this.el.setAttribute('lang', getLocale());
    setTextIfChanged(refs.mpmLabel, ' ' + t('stats.mpm'));
    setTextIfChanged(refs.activeLabel, ' ' + t('stats.active'));
    setTextIfChanged(refs.suspiciousLabel, ' ' + t('stats.suspicious'));
    setTextIfChanged(refs.wave, '🌊 ' + t('stats.wave'));
    this.update();
  }

  update() {
    if (!this.el || !this.el.isConnected) {
      return;
    }
    if (this.hidden) {
      this.remove();
      return;
    }

    this.stats = this.getStats() || EMPTY_STATS;
    const stats = this.stats;
    const refs = this.refs;

    const loading = getLoadingProgress({
      sessionMs: stats.sessionMs,
      cleanUsers: stats.cleanUsers,
      windowMessages: stats.windowMessages,
      isBotWave: stats.isBotWave,
    });
    this.loading = loading;

    const waveAlert = stats.chatConnected !== false && (stats.waveAlert || stats.isBotWave);
    const threshold = Number(
      (this.getSettings() || {}).suspiciousThreshold
    );
    setTextIfChanged(refs.mpm, stats.messagesPerMinute);
    setTextIfChanged(refs.active, stats.activeUsers);
    setTextIfChanged(refs.suspicious, stats.suspiciousPercent + '%');

    // Shared red-state rules: a bot wave, a suspicious share that reached the
    // user's own threshold, or (for the counter) a warn/critical verdict.
    // Share (0..1) vs threshold (10..100): compare in percent, never 0.25 >= 25.
    const suspiciousSharePercent = Number(stats.suspiciousShare) * 100;
    const suspiciousAlert =
      stats.chatConnected !== false && suspiciousSharePercent > 0 && suspiciousSharePercent >= threshold;
    this.alertState = isAlertState({
      isBotWave: waveAlert,
      threshold,
      suspiciousShare: stats.chatConnected === false ? 0 : stats.suspiciousShare,
    });
    refs.suspicious.classList.toggle('tcx-stats__value--alert', suspiciousAlert);

    if (loading.ready) {
      setTextIfChanged(refs.loadingValue, '100%');
      refs.loading.hidden = true;
    } else {
      setTextIfChanged(refs.loadingValue, loading.percent + '%');
      refs.loading.hidden = false;
    }
    setAttributeIfChanged(
      refs.loading,
      'aria-label',
      loading.ready
        ? t('stats.loadingDone', {
            done: loading.done,
            required: loading.required,
          })
        : t('stats.loadingTip', { percent: loading.percent })
    );
    if (loading.ready) {
      if (refs.loading.hasAttribute('title')) {
        refs.loading.removeAttribute('title');
      }
    } else {
      setAttributeIfChanged(
        refs.loading,
        'title',
        t('stats.loadingTitle', { percent: loading.percent })
      );
    }

    // Anything that should scream — a bot wave, a warning/critical viewer
    // verdict, or a suspicious share past the user's own threshold — paints
    // the whole strip red, so "red" means the same thing everywhere.
    this.alertState = this.alertState || suspiciousAlert;
    refs.root.classList.toggle('tcx-stats--alert', this.alertState);
    refs.root.classList.toggle('tcx-stats--loading', !loading.ready);
    refs.root.dataset.wave = waveAlert ? '1' : '0';
    refs.root.dataset.loading = String(loading.percent);
    refs.wave.hidden = !waveAlert;
    this.chatStatus = stats.chatConnected === false ? 'disconnected'
      : waveAlert ? 'wave'
      : suspiciousAlert ? 'suspicious'
        : loading.ready && stats.chatConnected !== false ? 'ok' : 'waiting';
    refs.root.dataset.tcxState = this.chatStatus;
    tooltipController.refresh(refs.root);
  }

  tooltipModel() {
    return Object.assign({}, EMPTY_STATS, this.stats || {}, {
      loading: this.loading,
      alertState: this.alertState,
      chatStatus: this.chatStatus,
      threshold: Number(this.getSettings()?.suspiciousThreshold) || 0,
    });
  }

  _resolveHost(container) {
    const streamChat = container.closest('.stream-chat');
    if (streamChat) {
      const header =
        streamChat.querySelector('.stream-chat-header') ||
        streamChat.querySelector('[data-test-selector="chat-room-header"]');
      return {
        host: streamChat,
        before: header ? header.nextSibling : streamChat.firstChild,
        sticky: false,
      };
    }

    return {
      host: container,
      before: container.firstChild,
      sticky: true,
    };
  }

  _create() {
    const rootEl = document.createElement('div');
    rootEl.className = 'tcx-stats';
    rootEl.dataset.tcxUi = 'stats';
    rootEl.setAttribute('role', 'status');
    rootEl.setAttribute('aria-live', 'off');
    rootEl.setAttribute('lang', getLocale());

    const mpm = this._createMetric('⚡', t('stats.mpm'));
    const active = this._createMetric('👥', t('stats.active'));
    const suspicious = this._createMetric('🤖', t('stats.suspicious'));
    suspicious.value.textContent = '0%';

    // "Загружаю… 66%": the dots hang off the word (a fixed-width ::after box),
    // and the percentage is last so its digits never jump around.
    const loading = document.createElement('span');
    loading.className = 'tcx-stats__loading';
    loading.dataset.tcxUi = 'loading';
    const loadingWord = document.createElement('span');
    loadingWord.className = 'tcx-stats__loading-word';
    loadingWord.textContent = t('counter.loading');
    const loadingValue = document.createElement('b');
    loadingValue.textContent = '0%';
    loading.appendChild(loadingWord);
    loading.appendChild(loadingValue);

    const wave = document.createElement('span');
    wave.className = 'tcx-stats__wave';
    wave.textContent = '🌊 ' + t('stats.wave');
    wave.hidden = true;

    const metrics = [mpm.element, active.element, suspicious.element];
    for (let i = 0; i < metrics.length; i += 1) {
      if (i > 0) {
        const separator = document.createElement('span');
        separator.className = 'tcx-stats__sep';
        separator.textContent = '|';
        rootEl.appendChild(separator);
      }
      rootEl.appendChild(metrics[i]);
    }
    rootEl.appendChild(loading);
    rootEl.appendChild(wave);

    this.refs = {
      root: rootEl,
      mpm: mpm.value,
      mpmLabel: mpm.label,
      active: active.value,
      activeLabel: active.label,
      suspicious: suspicious.value,
      suspiciousLabel: suspicious.label,
      loading,
      loadingValue,
      wave,
    };

    rootEl.tabIndex = 0;
    tooltipController.attach(rootEl, () => buildStatsTooltip(this.tooltipModel()), {
      interactive: true, disclosure: this.disclosure,
    });
    return rootEl;
  }

  _createMetric(emoji, labelText) {
    const span = document.createElement('span');
    span.className = 'tcx-stats__metric';
    span.appendChild(document.createTextNode(emoji + ' '));
    const value = document.createElement('b');
    value.textContent = '0';
    span.appendChild(value);
    const label = document.createElement('span');
    label.className = 'tcx-stats__label';
    label.textContent = ' ' + labelText;
    span.appendChild(label);
    return { element: span, value, label };
  }
}
