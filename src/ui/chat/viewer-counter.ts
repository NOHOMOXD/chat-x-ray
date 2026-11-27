import type { ViewerStats } from '../../analysis/viewer-estimate.ts';
import type { Settings } from '../../config/settings-model.ts';
import { buildCounterParts, viewerStatus } from './viewer-counter-model.ts';
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
  setAttributeIfChanged,
  setTextIfChanged,
} from '../shared/ui-utils.ts';
import { modeProfile } from '../../platform/chat-mode.ts';
import { broadcastLiveKey, savedRange } from '../../analysis/live-state.ts';
import { broadcastProfile } from '../../analysis/broadcast-profile.ts';
import { buildViewerModel, getLoadingProgress } from '../../analysis/viewer-estimate.ts';
import { ViewerHistory } from '../../analysis/viewer-history.ts';
import { tooltipController } from '../shared/tooltip-controller.ts';
import { buildViewerTooltip } from '../shared/tooltip-viewer.ts';

const VIEWER_COUNT_SELECTORS = [
  '[data-a-target="animated-channel-viewers-count"]',
  '.live-channel-metadata-bar [data-a-target$="-viewers-count"]',
  '[data-test-selector="channel-viewers-count"]',
];

import { parseTwitchViewerCount } from './parse-viewer-count.ts';


type ViewerModel = NonNullable<ReturnType<typeof buildViewerModel>>;
type OptionalViewerModel = { [K in keyof ViewerModel]?: ViewerModel[K] | undefined };
export type CounterModel = Omit<OptionalViewerModel, 'range'> & {
  range?: { low: number; high: number } | null | undefined;
  threshold?: number;
  historyProfile?: string;
  chatConnected?: boolean;
  sampledAt?: number;
  input?: unknown;
  observationMs?: number;
  chatAlert?: boolean;
  viewerStatus?: string;
  recentAge?: number | null;
};
export type CounterStats = ViewerStats & {
  activeUsers: number;
  serviceBots: number;
  cleanUsers: number;
  suspiciousShare: number;
  observationMs: number;
  chatConnected?: boolean;
  resumedViewerMedian?: number | null;
  topAuthorMessages: number;
  audienceMessages: number;
  messagesPerMinute: number;
  minuteUsers: number;
};
type SavedMeasurement = NonNullable<ReturnType<typeof savedRange>>;
type Identity = NonNullable<Parameters<typeof broadcastLiveKey>[0]>;
type ViewerSample = ViewerHistory['samples'][number];
type ViewerSettings = Pick<Settings, 'adjustViewerCounter' | 'recordSession' | 'suspiciousThreshold' | 'accountAgeLookup'>;
type Baseline = NonNullable<Parameters<typeof buildViewerModel>[0]>['baseline'];
type AcceptedSample = NonNullable<ReturnType<ViewerHistory['record']>>;
interface CounterOptions {
  getStats: (now: number) => CounterStats;
  getSettings: () => ViewerSettings;
  getBroadcast?: () => Identity | null;
  getSaved?: () => unknown;
  getMinute?: (now: number, samples: ViewerSample[], stats: CounterStats) => unknown;
  countMessages?: (from: number, to: number) => number | null;
  onSample?: (sample: AcceptedSample) => void;
  onModel?: (model: CounterModel) => void;
  viewerHistory?: ConstructorParameters<typeof ViewerHistory>[0];
  getBaseline?: () => Baseline;
  isPaused?: () => boolean;
  onMissing?: (now: number) => void;
  channel?: string;
  settleMs?: number;
}

export class ViewerCounterAdjuster {
  private readonly getStats: CounterOptions['getStats'];
  private readonly getSettings: CounterOptions['getSettings'];
  private readonly getBroadcast: () => Identity | null;
  private readonly getSaved: () => unknown;
  private readonly getMinute: NonNullable<CounterOptions['getMinute']>;
  private readonly countMessages: CounterOptions['countMessages'];
  private readonly onSample: CounterOptions['onSample'];
  private readonly onModel: CounterOptions['onModel'];
  readonly history: ViewerHistory;
  private readonly getBaseline: () => Baseline;
  private readonly isPaused: () => boolean;
  private readonly onMissing: (now: number) => void;
  private channel: string;
  threshold: number;
  private readonly settleMs: number;
  private settleUntil: number;
  private el: HTMLSpanElement | null;
  private targetNode: Element | null;
  model: CounterModel | null;
  private lastModel: CounterModel | null;
  private recent: { key: string | null; model: CounterModel | SavedMeasurement } | null = null;

  constructor(options: CounterOptions) {
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

  get lastMeasurement(): CounterModel | null {
    return this.lastModel;
  }

  get recentMeasurement(): CounterModel | SavedMeasurement | null {
    return this.recent?.model ?? null;
  }

  clearMeasurements(): void {
    this.recent = null;
    this.lastModel = null;
  }

  update(channel?: string) {
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
      const observedChatters = stats.observedChatters ?? Math.max(0, stats.activeUsers - stats.serviceBots);
      const model: CounterModel = { loading: getLoadingProgress(stats), observedChatters, audienceMessages: stats.observedAudienceMessages ?? stats.audienceMessages,
        waveCount: stats.waveCount, lastWave: stats.lastWave, waveAlert: stats.waveAlert,
        massCommand: stats.massCommand, churn: this.history.getStats(now),
        historyProfile: broadcastProfile({ ...settings, roomProfile: modeProfile(stats.roomMode) }) };
      model.viewerStatus = viewerStatus(model, stats, now, this.history.options.churnWindowMs);
      if (settings.adjustViewerCounter && target) this.renderMeasurement(target, model, now);
      else this.remove();
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
      ...(this.countMessages ? { countMessages: this.countMessages } : {}),
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
      baseline: this.getBaseline() ?? null,
    };
    if (typeof stats.resumedViewerMedian === 'number' && Number.isFinite(stats.resumedViewerMedian)) modelInput.history.median = stats.resumedViewerMedian;
    const builtModel = buildViewerModel(modelInput);

    if (!builtModel) {
      this.remove();
      return;
    }
    const model: CounterModel = builtModel;
    model.threshold = threshold;
    model.historyProfile = broadcastProfile({ ...settings, roomProfile: modeProfile(stats.roomMode) });
    model.chatConnected = stats.chatConnected !== false;
    model.sampledAt = now;
    model.input = modelInput;
    model.observationMs = stats.observationMs;
    model.chatAlert = stats.chatConnected !== false && (stats.waveAlert ||
      (stats.suspiciousShare > 0 && stats.suspiciousShare * 100 >= threshold));
    model.viewerStatus = viewerStatus(model, stats, now, this.history.options.churnWindowMs);
    this.lastModel = model;
    this.onModel?.(model);

    if (settings.adjustViewerCounter) {
      this.renderMeasurement(target, model, now);
    } else {
      this.remove();
      this.model = model;
    }
  }

  showLastMeasurement(settings: ViewerSettings, now: number) {
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
    const model = { ...this.lastModel, range: null, engagement: null,
      observedChatters: stats.observedChatters ?? (Math.max(0, stats.activeUsers - stats.serviceBots) || 0),
      audienceMessages: stats.observedAudienceMessages ?? stats.audienceMessages, waveCount: stats.waveCount,
      churn: this.history.getStats(now),
      historyProfile: broadcastProfile({ ...settings, roomProfile: modeProfile(stats.roomMode) }),
      chatConnected: false };
    model.viewerStatus = viewerStatus(model, { ...stats, chatConnected: false }, now, this.history.options.churnWindowMs);
    this.renderMeasurement(target, model, now);
  }

  renderMeasurement(target: Element, model: CounterModel, now: number) {
    const identity = this.getBroadcast();
    if (identity && model.range) this.recent = { key: broadcastLiveKey(identity), model };
    if (identity && !model.range) {
      const key = broadcastLiveKey(identity);
      const candidates = [this.recent?.key === key ? this.recent.model : null, savedRange(this.getSaved(), now)];
      const saved = candidates.filter((item): item is (CounterModel | SavedMeasurement) & {
        range: { low: number; high: number }; sampledAt: number;
      } => Boolean(item?.range && item.historyProfile === model.historyProfile &&
        typeof item.sampledAt === 'number' && item.sampledAt <= now))
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

  reset(channel?: string) {
    if (channel !== undefined) {
      this.channel = String(channel || '').toLowerCase();
    }
    this.remove();
    this.recent = null;
    this.history.reset();
    this.lastModel = null;
    this.settleUntil = Date.now() + this.settleMs;
  }

  /**
   * Repaint the estimate saved before a reload (same broadcast) while the new
   * page has not collected its own sample yet.
   */
  restoreSaved(identity: Identity, model: unknown) {
    const key = broadcastLiveKey(identity);
    const measurement = savedRange(model, Date.now());
    if (!key || !measurement) return false;
    this.recent = { key, model: measurement };
    return true;
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

  _render(target: Element, model: CounterModel) {
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

    const parts = buildCounterParts(model);
    setTextIfChanged(this.el, parts.text);
    const alert = ['churn', 'surge', 'lowEr', 'outflow', 'wave'].includes(model.viewerStatus ?? '');
    this.el.classList.toggle('tcx-real-viewers--alert', alert);
    this.el.dataset.tcxState = alert ? 'alert' : model.recentAge != null ? 'recent' : model.range ? 'range' : 'activity';
    setAttributeIfChanged(this.el, 'aria-label', parts.label || parts.text.trim());
    tooltipController.refresh(this.el);
  }
}
