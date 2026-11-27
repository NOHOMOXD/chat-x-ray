/*
 * Twitch Chat X-Ray — live summary strip view.
 * Mounts between Twitch's .stream-chat-header and .chat-room.
 * Uses selective text updates to prevent MutationObserver feedback loops.
 *
 */
import { isAlertState, setTextIfChanged } from '../shared/ui-utils.ts';
import { tooltipController } from '../shared/tooltip-controller.ts';
import { buildStatsTooltip } from '../shared/tooltip-stats.ts';
import { getLocale, t } from '../../i18n/i18n.ts';
import { getLoadingProgress } from '../../analysis/viewer-estimate.ts';

interface ChatStats {
  messagesPerMinute: number;
  activeUsers: number;
  cleanUsers: number;
  suspiciousPercent: number;
  suspiciousShare: number;
  windowMessages: number;
  auditLogCount?: number;
  isBotWave: boolean;
  sessionMs: number;
  chatConnected?: boolean;
  waveAlert?: boolean;
  topAuthorMessages?: number;
  audienceMessages?: number;
  neutralUsers?: number;
  suspiciousUsers?: number;
  idGroups?: { count: number; authors: number } | null;
  lastWave?: { ts: number; authors?: number } | null | undefined;
  minuteUsers?: number;
  freshUsers?: number;
  waveCount?: number;
  [field: string]: unknown;
}

interface StatsSettings {
  showChatStats?: boolean;
  suspiciousThreshold?: number;
}

interface StatsRefs {
  root: HTMLElement;
  mpm: HTMLElement;
  mpmLabel: HTMLElement;
  active: HTMLElement;
  activeLabel: HTMLElement;
  suspicious: HTMLElement;
  suspiciousLabel: HTMLElement;
  wave: HTMLElement;
}

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
  private readonly getStats: () => ChatStats | null;
  private readonly getSettings: () => StatsSettings;
  private el: HTMLElement | null = null;
  private refs: StatsRefs | null = null;
  private container: Element | null = null;
  private stats: ChatStats | null = null;
  private loading: unknown = null;
  private alertState = false;
  private disclosure = { open: false };
  private chatStatus: string | undefined;

  constructor(options: { getStats: () => ChatStats | null; getSettings?: () => StatsSettings }) {
    this.getStats = options.getStats;
    this.getSettings = options.getSettings || (() => ({ showChatStats: true }));
  }

  get hidden() {
    const settings = this.getSettings() || {};
    return settings.showChatStats === false;
  }

  ensure(container: Element | null) {
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
    if (!refs) return;
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
    if (!refs) return;

    const loading = getLoadingProgress(stats);
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

    // Anything that should scream — a bot wave, a warning/critical viewer
    // verdict, or a suspicious share past the user's own threshold — paints
    // the whole strip red, so "red" means the same thing everywhere.
    this.alertState = this.alertState || suspiciousAlert;
    refs.root.classList.toggle('tcx-stats--alert', this.alertState);
    refs.root.dataset.wave = waveAlert ? '1' : '0';
    refs.wave.hidden = !waveAlert;
    this.chatStatus = stats.chatConnected === false ? 'disconnected'
      : waveAlert ? 'wave'
      : suspiciousAlert ? 'suspicious'
        : loading.ready ? 'ok' : 'waiting';
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

  _resolveHost(container: Element) {
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

    const wave = document.createElement('span');
    wave.className = 'tcx-stats__wave';
    wave.textContent = '🌊 ' + t('stats.wave');
    wave.hidden = true;

    const metrics = [mpm.element, active.element, suspicious.element];
    for (const [i, metric] of metrics.entries()) {
      if (i > 0) {
        const separator = document.createElement('span');
        separator.className = 'tcx-stats__sep';
        separator.textContent = '|';
        rootEl.appendChild(separator);
      }
      rootEl.appendChild(metric);
    }
    rootEl.appendChild(wave);

    this.refs = {
      root: rootEl,
      mpm: mpm.value,
      mpmLabel: mpm.label,
      active: active.value,
      activeLabel: active.label,
      suspicious: suspicious.value,
      suspiciousLabel: suspicious.label,
      wave,
    };

    rootEl.tabIndex = 0;
    tooltipController.attach(rootEl, () => buildStatsTooltip(this.tooltipModel()), {
      interactive: true, disclosure: this.disclosure,
    });
    return rootEl;
  }

  _createMetric(emoji: string, labelText: string) {
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
