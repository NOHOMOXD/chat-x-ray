import type { BridgePayload } from '../platform/message-bridge.ts';
import type { MinuteStats, ViewerSample } from './minute-snapshot.ts';
import type { Settings } from '../config/settings-model.ts';
import type { SettingsRepository } from '../config/settings.ts';
import type { BroadcastIdentity } from '../platform/broadcast-identity.ts';
import type { RoomEvent } from '../platform/bridge-control.ts';
import type { HistoryResponse } from '../platform/broadcast-history-client.ts';
import type { HistoryEvent } from '../analysis/broadcast-checkpoint.ts';
import type { ChatRecord } from '../core/chat-session.ts';
import { assessBroadcastModel, collectBroadcastGroups, prepareBroadcastUpdate } from '../analysis/broadcast-observation.ts';
import { completeSessionSnapshot } from '../analysis/session-export.ts';
import { processChatMessage } from './process-chat-message.ts';
import { buildViewerStats } from './viewer-stats.ts';
import { UiUpdateScheduler } from './ui-update-scheduler.ts';
import { buildMinuteSnapshot, countObservedMessages } from './minute-snapshot.ts';
import { navigationAction } from './channel-navigation.ts';
import { handleBridgeControl } from './bridge-control-handler.ts';
import { sameSettings } from '../config/settings-model.ts';
import { PageLifecycle } from './page-lifecycle.ts';
import { findMessageContainer, getChannelSlug, readTwitchLang } from '../platform/twitch-page.ts';
import { MessageBridge } from '../platform/message-bridge.ts';
import { SessionCapture } from '../analysis/session-capture.ts';
import { downloadJson } from '../ui/shared/download-json.ts';
/*
 * Twitch Chat X-Ray — application controller (ISOLATED world).
 * Manages lifecycle, composition and DOM updates:
 *   - Analyzer (scoring, adaptive R9K, bot logging)
 *   - MessageBinder (WebSocket → DOM row binding)
 *   - StatsView (summary strip above chat, hideable)
 *   - ViewerCounterAdjuster (passive viewer count adjustment under player)
 *   - SettingsModal (floating settings window opened from the chat header)
 *   - SettingsRepository (chrome.storage.local persistence)
 *
 * The UI language is resolved from settings.language and, when it is "auto",
 * from the browser languages (only Russian is honoured; everything else falls
 * back to English).
 */
import { Analyzer } from '../core/analyzer.ts';
import { modeProfile } from '../platform/chat-mode.ts';
import { MessageBinder } from '../ui/chat/message-binder.ts';
import { StatsView } from '../ui/chat/stats-view.ts';
import { SettingsModal } from '../ui/settings/settings-panel.ts';
import {
  normalizeSettings,
  DEFAULTS,
} from '../config/settings.ts';
import { ViewerCounterAdjuster } from '../ui/chat/viewer-counter.ts';
import { AccountAgeService } from '../platform/account-age.ts';
import { HISTORY_CLEAR_KEY } from '../analysis/broadcast-history.ts';
import { broadcastProfile } from '../analysis/broadcast-profile.ts';
import { checkpointMerge } from '../analysis/broadcast-checkpoint.ts';
import { createBroadcastHistoryClient } from '../platform/broadcast-history-client.ts';
import { onStorageChanged } from '../platform/browser-api.ts';
import { broadcastIdentity, normalizeBroadcast } from '../platform/broadcast-identity.ts';
import { MAX_OBSERVATION_GAP, ObservationClock } from '../analysis/observation-clock.ts';
import {
  LIVE_PERSIST_INTERVAL_MS,
  broadcastLiveKey,
  conflictingBroadcasts,
  createLiveSnapshot,
  resumedWindow,
  restoreLiveSnapshot,
  sameLiveBroadcast,
} from '../analysis/live-state.ts';
import { recordsAt } from '../core/id-group-diagnostics.ts';
import { analyzeGroupRecurrence, buildGroupObservation, applyGroupHistoryBonus } from '../analysis/group-history.ts';
import { isExtensionMutation } from '../ui/shared/ui-utils.ts';
import { resolveLocale, setLocale } from '../i18n/i18n.ts';

const TWITCH_LANG = readTwitchLang();

type LiveSnapshot = NonNullable<ReturnType<typeof restoreLiveSnapshot>>;
type ActiveBroadcast = BroadcastIdentity & { firstObservedAt?: number };
type BroadcastData = HistoryResponse & { profile: string };

export class ChatXRayApp {
  settingsRepository: SettingsRepository;
  settings: Settings;
  analyzer: Analyzer;
  accountAgeService: AccountAgeService;
  channel: string;
  previousChannel: string;
  openSockets = new Set<number>();
  rooms = new Map<string, RoomEvent>();
  roomSince: number;
  chatSince: number | null = null;
  capture: SessionCapture | null = null;
  finishedCapture: ReturnType<typeof completeSessionSnapshot> | null = null;
  lastMaintenance: number | null = null;
  lastViewerSample: number | null = null;
  viewerGap = false;
  urlLagChannel = '';
  channelChangedAt: number;
  lastMessageChannel = '';
  broadcastHistory: ReturnType<typeof createBroadcastHistoryClient>;
  knownBroadcasts = new Map<string, { identity: BroadcastIdentity; seenAt: number }>();
  pendingBroadcast: Promise<unknown> = Promise.resolve();
  historyClearedAt = 0;
  tabOpenedAt: number;
  broadcast: ActiveBroadcast | null = null;
  restoredBroadcast: ActiveBroadcast | null = null;
  broadcastData: BroadcastData | null = null;
  groupRecurrence: ReturnType<typeof analyzeGroupRecurrence> | null = null;
  latestGroupWindow: Awaited<ReturnType<typeof buildGroupObservation>> | null = null;
  hasCompleteObservation = false;
  lastCheckpoint = -Infinity;
  chatClock = new ObservationClock();
  formulaClock = new ObservationClock();
  viewerClock = new ObservationClock();
  observedEvents: HistoryEvent[] = [];
  tabLease: string | null = null;
  liveReady = false;
  lastLiveWrite = -Infinity;
  savedFreshRange = false;
  restoredRows: Array<ChatRecord & { botScore: number }> = [];
  restoredTab: LiveSnapshot | null = null;
  pendingTabSnapshot: LiveSnapshot | null = null;
  restoredCheckpointFor: string | null = null;
  offline = false;
  frozen = false;
  container: Element | null = null;
  pageObserver: MutationObserver | null = null;
  started = false;
  startGeneration = 0;
  unsubscribeSettings: (() => void) | null = null;
  unsubscribeHistory: (() => void) | null = null;
  bridge: MessageBridge;
  pageLifecycle: PageLifecycle;
  binder: MessageBinder;
  statsView: StatsView;
  viewerCounter: ViewerCounterAdjuster;
  settingsPanel: SettingsModal;
  uiUpdates: UiUpdateScheduler;
  clearingHistory = false;
  broadcastProfile: string | null = null;
  renderedIdGroups: Analyzer['idGroupSnapshot'] = null;

  constructor(settingsRepository: SettingsRepository) {
    this.settingsRepository = settingsRepository;
    this.settings = normalizeSettings(DEFAULTS);
    // Resolve the interface language before any UI is created, so the first
    // paint already uses the Twitch language (or the saved choice).
    setLocale(resolveLocale(this.settings.language, { htmlLang: TWITCH_LANG }));
    // The analyzer must already run with the saved threshold (default 30%),
    // otherwise the first seconds of chat are scored against a stale value.
    this.analyzer = new Analyzer(this.settings);
    this.accountAgeService = new AccountAgeService({
      getSettings: () => this.settings,
      onAge: (login, ageDays) => this.handleAccountAge(login, ageDays),
      onError: (error) =>
        console.warn(
          '[Twitch Chat X-Ray] account age lookup failed',
          error
        ),
    });
    this.channel = getChannelSlug();
    this.previousChannel = this.channel;
    this.openSockets = new Set();
    this.rooms = new Map();
    this.roomSince = Date.now();

    this.chatSince = null;
    this.capture = null;
    this.finishedCapture = null;
    this.lastMaintenance = null;
    this.lastViewerSample = null;
    this.viewerGap = false;
    this.urlLagChannel = '';
    this.channelChangedAt = Date.now();
    this.lastMessageChannel = '';
    this.broadcastHistory = createBroadcastHistoryClient();
    this.knownBroadcasts = new Map();
    this.pendingBroadcast = Promise.resolve();
    this.historyClearedAt = 0;
    this.tabOpenedAt = Date.now();
    this.resetObservation();
    this.frozen = false;
    this.container = null;
    this.pageObserver = null;
    this.started = false;
    this.startGeneration = 0;
    this.unsubscribeSettings = null;
    this.unsubscribeHistory = null;
    this.bridge = new MessageBridge((data) => this.processMessages(data));
    this.pageLifecycle = new PageLifecycle({
      navigate: () => this.handleNavigation(),
      maintain: () => this.maintenance(),
      freeze: () => { this.frozen = true; this.interruptObservation('freeze'); },
      resume: () => { this.frozen = false; this.maintenance(); },
      pageHide: () => { this.persistLiveState(); this.interruptObservation('pagehide'); },
      hidden: () => this.persistLiveState(),
    });

    this.binder = new MessageBinder({
      getSettings: () => ({ ...this.settings, getIdGroup: (id) => id === null ? undefined : this.analyzer.idGroupsById.get(id),
        getGroupHistory: (id) => id === null ? undefined : this.groupRecurrence?.authors[id],
        observedBroadcasts: this.groupRecurrence?.observedBroadcasts }),
    });
    this.statsView = new StatsView({
      getStats: () => this.getViewerStats(Date.now(), true),
      getSettings: () => this.settings,
    });
    this.viewerCounter = new ViewerCounterAdjuster({
      getBroadcast: () => this.broadcast,
      getSaved: () => {
        const saved = this.broadcastData?.checkpoint?.lastRangeModel;
        return saved?.rangeVersion === 1 ? saved : null;
      },
      getStats: (now) => this.getViewerStats(now),
      getMinute: (now, samples, stats) => this.getMinute(now, samples, stats),
      countMessages: (from, to) => this.countMessages(from, to),
      onSample: (accepted) => this.recordViewerSample(accepted),
      onModel: (model) => {
        this.capture?.recordModel(model);
        if (model.range && !this.savedFreshRange && this.liveReady) {
          this.persistLiveState();
          this.syncBroadcast(true);
        }
      },
      onMissing: () => this.interruptViewer('viewer-missing'),
      isPaused: () => this.frozen,
      getBaseline: () => this.broadcastData?.profile === broadcastProfile(this.historySettings())
        ? this.broadcastData.baseline : null,
      getSettings: () => this.settings,
      channel: this.channel,
    });
    this.settingsPanel = new SettingsModal({
      getSettings: () => this.settings,
      getLogger: () => this.analyzer.logger,
      downloadSession: (previous) => this.downloadSession(previous),
      clearHistory: () => this.clearHistory(),
      onCommit: (next) => this.applySettings(next, true),
    });

    this.uiUpdates = new UiUpdateScheduler(
      () => {
        const container = this.container || findMessageContainer();
        if (container) this.binder.bindRows(container);
      },
      () => {
        this.statsView.update();
        this.viewerCounter.update(this.channel);
      },
    );

    this.handleStorageChange = this.handleStorageChange.bind(this);
    this.handleNavigation = this.handleNavigation.bind(this);
    this.handlePageMutation = this.handlePageMutation.bind(this);
  }

  start() {
    if (this.started) {
      return;
    }
    this.started = true;
    const generation = ++this.startGeneration;
    this.openLiveState(true);

    this.bridge.start();
    this.unsubscribeSettings = this.settingsRepository.subscribe(this.handleStorageChange);
    this.unsubscribeHistory = onStorageChanged((changes, area) => {
      if (area === 'local' && changes[HISTORY_CLEAR_KEY]) {
        this.onHistoryCleared(changes[HISTORY_CLEAR_KEY].newValue);
      }
    });

    this.settingsRepository.load().then((settings) => {
      if (!this.started || generation !== this.startGeneration) return;
      this.settings = settings;
      this.applyLanguage(settings);
      this.analyzer.updateOptions({
        suspiciousThreshold: settings.suspiciousThreshold,
        enableAuditLog: settings.enableAuditLog,
      });
      this.binder.refresh();
      this.statsView.refreshLabels();
      this.settingsPanel.sync();
      this.viewerCounter.update(this.channel);
    });

    this.pageObserver = new MutationObserver(this.handlePageMutation);
    this.pageObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    this.settingsPanel.start();
    // The chat header may not exist yet; the maintenance loop re-pins the
    // floating settings button as soon as it appears.
    this.settingsPanel.ensureButton();
    // The lifecycle owner manages both event listeners and periodic checks.
    this.pageLifecycle.start();
    this.maintenance();
  }

  /** Permanently detach the current run; a later start creates fresh subscriptions. */
  stop() {
    if (!this.started) return;
    this.persistLiveState();
    this.interruptObservation('stop');
    this.started = false;
    this.startGeneration += 1;
    this.pageLifecycle.stop();
    this.bridge.stop();
    this.unsubscribeSettings?.();
    this.unsubscribeHistory?.();
    this.unsubscribeSettings = null;
    this.unsubscribeHistory = null;
    this.pageObserver?.disconnect();
    this.pageObserver = null;
    this.uiUpdates.stop();
    this.accountAgeService.clearQueue();
    this.settingsPanel.stop();
    this.binder.reset();
    this.statsView.remove();
    this.viewerCounter.remove();
    this.openSockets.clear();
    this.rooms.clear();
    this.container = null;
    this.tabLease = null;
    this.liveReady = false;
  }

  // Process controls before later chat messages in the same packet.
  handleBridgeControl(input: unknown) {
    return handleBridgeControl(this, input);
  }

  processMessages(data: BridgePayload) {
    let waveTriggered = false;
    for (let i = 0; i < data.messages.length; i += 1) {
      const message = data.messages[i];
      if (this.handleBridgeControl(message)) continue;
      if (this.processChatMessage(message)) waveTriggered = true;
    }

    if (waveTriggered || this.analyzer.confirmationDirty) {
      this.analyzer.confirmationDirty = false;
      this.viewerCounter.update(this.channel);
      this.syncBroadcast(true);
      this.binder.refresh();
    }
    this.scheduleBind();
    this.scheduleStats();
  }

  // Process one chat message after control events from the same packet.
  processChatMessage(message: unknown) {
    return processChatMessage(this, message);
  }

  handlePageMutation(mutations: MutationRecord[]) {
    let relevant = false;
    for (const mutation of mutations) {
      if (!isExtensionMutation(mutation)) {
        relevant = true;
        break;
      }
    }
    if (!relevant) {
      return;
    }

    // Hide suspicious/R9K rows in the MutationObserver callback, before paint.
    // The synchronous message bridge above has already put the record in the
    // pending queue, so the row is usually matched here.
    this.binder.fastHideMutations(mutations);

    this.scheduleBind();
    this.scheduleStats();
    // Re-pin the settings entry points when Twitch re-renders the header or
    // opens its Chat Settings popover.
    this.settingsPanel.ensureButton();
  }

  handleAccountAge(login: string, ageDays: number) {
    if (!this.started || !this.settings.accountAgeLookup) {
      return;
    }
    if (this.analyzer.accountAges.get(login.toLowerCase()) === ageDays) return;
    const changed = this.analyzer.applyAccountAge(login, ageDays);
    if (changed) {
      this.binder.refresh();
      this.statsView.update();
      this.viewerCounter.update(this.channel);
    }
  }

  handleStorageChange(settings: Settings) {
    // chrome.storage.onChanged also fires for *this* tab's own writes, which
    // applySettings() has already applied. Comparing the incoming record with
    // the live one skips that echo, so one toggle no longer rebuilds the whole
    // DOM twice (and cannot fight with the user's drag on the slider).
    if (sameSettings(this.settings, settings)) {
      return;
    }
    this.settings = settings;
    this.applyLanguage(settings);
    this.analyzer.updateOptions({
      suspiciousThreshold: settings.suspiciousThreshold,
      enableAuditLog: settings.enableAuditLog,
    });
    if (!settings.accountAgeLookup) {
      this.accountAgeService.clearQueue();
    }
    this.binder.refresh();
    this.statsView.refreshLabels();
    this.viewerCounter.update(this.channel);
    // sync()/refreshLabels() of the modal re-render labels and values in one
    // pass, so an open settings window never shows the old language.
    this.settingsPanel.refreshLabels();
  }

  /**
   * Apply the UI language. setLocale() returns true only when the language
   * actually changed, so a no-op storage echo never rebuilds the whole UI.
   */
  applyLanguage(settings: Settings) {
    const next = resolveLocale(
      (settings || this.settings || DEFAULTS).language,
      { htmlLang: TWITCH_LANG }
    );
    if (!setLocale(next)) {
      return false;
    }
    this.binder.refresh();
    this.statsView.refreshLabels();
    this.viewerCounter.update(this.channel);
    this.settingsPanel.refreshLabels();
    return true;
  }

  handleNavigation() {
    const channel = getChannelSlug();
    const action = navigationAction({
      urlChannel: channel, currentChannel: this.channel,
      lastMessageChannel: this.lastMessageChannel, urlLagChannel: this.urlLagChannel,
    });
    if (action === 'ignore') return;
    if (action === 'caught-up') {
      this.urlLagChannel = '';
      return;
    }
    this.resetChannel(channel);
  }

  applySettings(next: Settings, persist: boolean) {
    this.settings = normalizeSettings(next);
    this.applyLanguage(this.settings);
    this.analyzer.updateOptions({
      suspiciousThreshold: this.settings.suspiciousThreshold,
      enableAuditLog: this.settings.enableAuditLog,
    });
    if (!this.settings.accountAgeLookup) {
      this.accountAgeService.clearQueue();
    }
    this.binder.refresh();
    // statsView.update() also honours showChatStats, so toggling the strip in
    // the modal takes effect immediately without waiting for the next tick.
    this.statsView.refreshLabels();
    this.viewerCounter.update(this.channel);
    if (persist) {
      this.settingsRepository.save(this.settings);
    }
  }

  resetChannel(channel: string, fromMessage = false) {
    const switching = channel && channel !== this.channel;
    if (switching) this.persistLiveState();
    this.syncBroadcast(true);
    if (channel && channel !== this.channel) {
      this.rooms.delete(this.channel);
      this.previousChannel = this.channel;
    }
    // Remember which URL value would be a lagging old page after a chat-first
    // switch; a URL reset means there is no lag to protect against.
    this.urlLagChannel = fromMessage ? this.previousChannel : '';
    if (this.capture) {
      this.finishedCapture = this.buildSessionSnapshot();
      this.capture = null;
    }
    this.chatSince = this.openSockets.size && channel ? Date.now() : null;
    this.lastViewerSample = null;
    this.viewerGap = false;
    this.roomSince = Date.now();

    this.resetObservation();
    this.analyzer.reset();
    this.accountAgeService.resetQueue();
    this.channel = channel;
    this.openLiveState(Boolean(switching));
    const known = this.knownBroadcasts.get(channel);
    if (known && Date.now() - known.seenAt <= MAX_OBSERVATION_GAP) this.setBroadcast(known.identity);
    this.channelChangedAt = Date.now();
    this.binder.reset();
    this.statsView.remove();
    // Finalizes the old session's ER baseline, clears churn history and waits
    // for Twitch to render the new channel before sampling its viewer count.
    this.viewerCounter.reset(this.channel);
    this.container = null;
    this.scheduleBind();
    this.scheduleStats();
  }

  scheduleBind() {
    this.uiUpdates.scheduleBind();
  }

  scheduleStats() {
    this.uiUpdates.scheduleStats();
  }

  historySettings() {
    return { ...this.settings, roomProfile: modeProfile(this.rooms.get(this.channel)?.mode) };
  }

  getViewerStats(now = Date.now(), displayWindow = false) {
    const since = this.chatSince ?? now;
    this.restoreTabCoverage();
    const formula = this.formulaClock.snapshot(this.chatSince !== null && !this.frozen ? now : undefined);
    const pendingFormula = this.restoredTab?.formula ?? [];
    const windowStart = resumedWindow([...pendingFormula, ...formula], now).start;
    this.analyzer.session.retentionStart = windowStart;
    this.viewerCounter.history.retentionStart = windowStart;
    const stats = this.analyzer.getStats(now, since);
    if (this.restoredRows.length) this.restoredRows = this.restoredRows.filter(record => record.ts >= windowStart);
    return buildViewerStats({
      now, displayWindow, stats, chatSince: this.chatSince, roomSince: this.roomSince,
      channelChangedAt: this.channelChangedAt, roomMode: this.rooms.get(this.channel)?.mode ?? {},
      observedEvents: this.observedEvents, persistedEvents: this.broadcastData?.checkpoint?.events || [],
      records: this.analyzer.session.records, restoredRows: this.restoredRows,
      threshold: this.settings.suspiciousThreshold, hasBroadcast: Boolean(this.broadcast),
      formulaCoverage: formula,
      chatCoverage: this.chatClock.snapshot(),
      persistedChatCoverage: this.broadcastData?.checkpoint?.intervals?.chat || [],
      hasRestoredSamples: Boolean(this.restoredTab?.samples?.length),
      restoredSamples: () => this.restoredSamples(now),
    });
  }

  countMessages(from: number, to: number) {
    return countObservedMessages(this.analyzer.session.records, this.chatSince, from, to);
  }

  getMinute(now: number, samples: ViewerSample[], stats: MinuteStats = this.getViewerStats(now)) {
    return buildMinuteSnapshot(now, this.chatSince, samples, stats);
  }

  resetObservation() {
    this.broadcast = null;
    this.restoredBroadcast = null;
    this.broadcastData = null;
    this.groupRecurrence = null;
    this.latestGroupWindow = null;
    this.hasCompleteObservation = false;
    this.lastCheckpoint = -Infinity;
    this.chatClock = new ObservationClock();
    this.formulaClock = new ObservationClock();
    this.viewerClock = new ObservationClock();
    this.observedEvents = [];
    this.tabLease = null;
    this.liveReady = false;
    this.lastLiveWrite = -Infinity;
    this.savedFreshRange = false;
    this.restoredRows = [];
    this.restoredTab = null;
    this.pendingTabSnapshot = null;
    this.restoredCheckpointFor = null;
    this.offline = false;
  }

  openLiveState(reload: boolean) {
    const lease = this.tabLease = crypto.randomUUID();
    const channel = this.channel;
    this.liveReady = false;
    this.broadcastHistory.openTab(lease, reload, channel).then(snapshot => {
      if (lease !== this.tabLease) return;
      const now = Date.now();
      const saved = restoreLiveSnapshot(snapshot, channel, this.broadcast, now);
      if (!saved || saved.savedAt <= this.historyClearedAt) return;
      if (saved.requireIdentity && !this.broadcast) {
        this.pendingTabSnapshot = saved;
        return;
      }
      this.applyTabSnapshot(saved);
    }).catch(error => console.warn('[Twitch Chat X-Ray] reload checkpoint', error?.message))
      .finally(() => {
        if (lease === this.tabLease) this.liveReady = true;
      });
  }

  applyTabSnapshot(saved: LiveSnapshot) {
    const now = Date.now();
    this.restoredTab = saved;
    this.chatClock.includeCoverage(saved.chat);
    this.viewerClock.includeCoverage(saved.viewer);
    const current = new Map(this.analyzer.session.records.map(record => [record.id, record]));
    this.restoredRows = saved.rows.filter(record => !current.has(record.id));
    for (const record of this.restoredRows) this.analyzer.session.markSeen(record.id, now);
    this.observedEvents = checkpointMerge({ events: saved.events }, { events: this.observedEvents }).events;
    this.viewerCounter.history.restoreEvents(this.observedEvents);
    this.analyzer.restoreBotMemory(saved, this.broadcastData?.history);
    for (const record of current.values()) this.analyzer.auditRecord(record);
    this.restoreTabRange();
    this.binder.refresh();
    this.scheduleStats();
  }

  restoreTabCoverage() {
    const saved = this.restoredTab;
    if (saved?.formula?.length && sameLiveBroadcast(saved.identity, this.broadcast) &&
        saved.profile === broadcastProfile(this.historySettings())) {
      this.formulaClock.includeCoverage(saved.formula);
      saved.formula = [];
    }
  }

  restoreTabRange() {
    const saved = this.restoredTab;
    if (saved && this.broadcast && sameLiveBroadcast(saved.identity, this.broadcast)) {
      this.restoreTabCoverage();
      this.viewerCounter.restoreSaved(this.broadcast, saved.model);
    }
  }

  persistLiveState(now = Date.now()) {
    if (!this.liveReady || !this.channel || !this.tabLease || this.offline || this.clearingHistory) return;
    if (this.pendingTabSnapshot && !this.broadcast) return;
    const currentProfile = broadcastProfile(this.historySettings());
    const saved = this.restoredTab;
    const awaitingIdentity = !this.broadcast && saved?.formula.length && saved.profile;
    const profile = awaitingIdentity ? saved.profile : currentProfile;
    const pendingFormula = saved && saved.profile === profile &&
      (!this.broadcast || sameLiveBroadcast(saved.identity, this.broadcast)) ? saved.formula : [];
    const currentFormula = profile === currentProfile
      ? this.formulaClock.snapshot(this.chatSince !== null && !this.frozen ? now : undefined) : [];
    const recent = this.viewerCounter.recentMeasurement;
    const range = this.broadcast && (this.viewerCounter.lastMeasurement?.range ? this.viewerCounter.lastMeasurement : recent);
    const events = checkpointMerge(this.broadcastData?.checkpoint ?? {}, { events: this.observedEvents }).events;
    const records = this.restoredRows.concat(this.analyzer.session.records)
      .filter(record => record.ts > this.historyClearedAt);
    const samples = this.restoredSamples(now);
    const snapshot = createLiveSnapshot({
      channel: this.channel, identity: this.broadcast ?? this.restoredTab?.identity ?? null, now,
      chat: this.chatClock.snapshot(), viewer: this.viewerClock.snapshot(),
      model: range ?? this.restoredTab?.model ?? null, records,
      formula: [...pendingFormula, ...currentFormula], profile,
      events, confirmed: this.analyzer.confirmed, bonuses: this.analyzer.bonuses, samples,
    });
    if (!snapshot) return;
    this.lastLiveWrite = now;
    this.savedFreshRange = Boolean(this.viewerCounter.lastMeasurement?.range);
    this.broadcastHistory.saveTab(this.tabLease, snapshot).catch(error => {
      console.warn('[Twitch Chat X-Ray] reload checkpoint', error?.message);
    });
  }

  restoredSamples(now: number) {
    const cutoff = Math.min(now - this.viewerCounter.history.options.retainMs,
      resumedWindow(this.formulaClock.snapshot(), now).start);
    return (this.restoredTab?.samples ?? []).concat(this.viewerCounter.history.samples)
      .filter(sample => sample.ts >= cutoff && sample.ts <= now && sample.ts > this.historyClearedAt);
  }

  recordEvent(event: HistoryEvent) {
    this.observedEvents.push(event);
    this.capture?.events.push(event);
  }

  setBroadcast(identity: BroadcastIdentity) {
    const normalized = normalizeBroadcast(identity.channel, identity.id, identity.startedAt);
    if (!normalized || normalized.channel !== this.channel) return;
    const { id, startedAt } = normalized;
    this.offline = false;
    if (this.restoredTab && (conflictingBroadcasts(this.restoredTab.identity, normalized) ||
        (normalized.startedAt !== null && normalized.startedAt > this.restoredTab.savedAt))) {
      this.knownBroadcasts.delete(this.channel);
      this.resetChannel(this.channel);
    }
    const previous = this.broadcast;
    if (startedAt && previous?.startedAt && startedAt < previous.startedAt) return;
    if (previous?.id && id === previous.id && (previous.startedAt || !startedAt)) return;
    if (!id && previous && (!previous.startedAt || previous.startedAt === startedAt)) return;
    const changed = previous && ((id && previous.id && id !== previous.id) ||
      (startedAt && previous.startedAt && startedAt !== previous.startedAt));
    if (changed) {
      this.knownBroadcasts.delete(this.channel);
      this.resetChannel(normalized.channel);
    }

    this.broadcast = { ...normalized, id: normalized.id ?? (changed ? null : previous?.id ?? null),
      startedAt: normalized.startedAt ?? (changed ? null : previous?.startedAt ?? null),
      firstObservedAt: this.broadcast?.firstObservedAt ?? Date.now() };
    this.broadcastData = null;
    this.lastCheckpoint = -Infinity;
    if (this.pendingTabSnapshot) {
      const pending = this.pendingTabSnapshot;
      this.pendingTabSnapshot = null;
      if (sameLiveBroadcast(pending.identity, this.broadcast)) this.applyTabSnapshot(pending);
    }
    this.restoreTabRange();
  }

  async clearHistory() {
    this.clearingHistory = true;
    try {
      await this.pendingBroadcast;
      this.onHistoryCleared(await this.broadcastHistory.clear());
    } finally {
      this.clearingHistory = false;
    }
  }

  onHistoryCleared(ts: unknown) {
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= this.historyClearedAt) return;
    this.historyClearedAt = ts;
    if (ts < this.tabOpenedAt) return;
    this.broadcastData = null;
    this.groupRecurrence = null;
    this.latestGroupWindow = null;
    this.hasCompleteObservation = false;
    this.observedEvents = this.observedEvents.filter((event) => event.ts > ts);
    this.chatClock = new ObservationClock();
    this.formulaClock = new ObservationClock();
    this.viewerClock = new ObservationClock();
    this.chatSince = this.chatSince === null ? null : Math.max(this.chatSince, ts);
    this.viewerCounter.history.reset();
    this.viewerCounter.clearMeasurements();
    this.restoredRows = [];
    this.restoredTab = null;
    this.pendingTabSnapshot = null;
    this.openLiveState(false);
    this.restoredCheckpointFor = null;
    this.lastLiveWrite = -Infinity;
    this.lastViewerSample = null;
    this.viewerGap = false;
    this.analyzer.clearBotMemory();
    this.analyzer.waveCount = 0;
    this.analyzer.lastWave = null;
    this.lastCheckpoint = Date.now();
    this.binder.refresh();
  }

  syncBroadcast(force = false, now = Date.now()) {
    const identity = this.broadcast;
    if (!identity || this.clearingHistory || !this.liveReady) return;
    const settings = this.historySettings();
    const clearingGeneration = this.historyClearedAt;
    const profile = broadcastProfile(settings);
    const initial = this.broadcastProfile !== profile || this.lastCheckpoint === -Infinity;
    this.broadcastProfile = profile;
    const model = this.viewerCounter.lastMeasurement;
    const { compatible: compatibleModel, complete } = assessBroadcastModel({
      model, profile, roomSince: this.roomSince, chatSince: this.chatClock.since,
      viewerSince: this.viewerClock.since, now,
    });
    const firstFull = complete && (!this.hasCompleteObservation || initial);
    if (!force && !initial && !firstFull && now - this.lastCheckpoint < 60000) return;
    this.hasCompleteObservation = (this.hasCompleteObservation && !initial) || complete;
    this.lastCheckpoint = now;
    const records = recordsAt(this.analyzer.session.records, now)
      .filter((record) => record.ts > this.historyClearedAt);
    const currentGroups = collectBroadcastGroups(
      records, this.analyzer.pastWaves, now, this.chatSince !== null,
    );
    const update = prepareBroadcastUpdate({
      now, model, compatible: compatibleModel, complete,
      confirmed: this.analyzer.confirmed, bonuses: this.analyzer.bonuses,
      chatIntervals: this.chatClock.snapshot(), viewerIntervals: this.viewerClock.snapshot(),
      events: this.observedEvents,
    });
    const generation = this.startGeneration;
    this.pendingBroadcast = this.pendingBroadcast.then(async () => {
      if (currentGroups) update.groups.push(await buildGroupObservation(currentGroups, { ts: now }));
      const data = await this.broadcastHistory.save(identity, settings, update);
      if (!this.started || generation !== this.startGeneration) return;
      this.onHistoryCleared(data.clearedAt);
      if (identity !== this.broadcast || profile !== broadcastProfile(this.historySettings()) ||
          (this.historyClearedAt !== clearingGeneration && this.historyClearedAt >= this.tabOpenedAt)) return;
      if (data.checkpoint) {
        const checkpoint = checkpointMerge(data.checkpoint, { events: this.observedEvents });
        this.viewerCounter.history.restoreEvents(checkpoint.events);
        this.analyzer.restoreBotMemory(checkpoint, data.history);
        for (const record of records) this.analyzer.auditRecord(record);
        const liveKey = broadcastLiveKey(identity);
        if (liveKey && this.restoredCheckpointFor !== liveKey) {
          this.restoredCheckpointFor = liveKey;
          this.chatClock.includeCoverage(checkpoint.intervals?.chat ?? []);
          this.viewerClock.includeCoverage(checkpoint.intervals?.viewer ?? []);
        }
        const saved = checkpoint.lastRangeModel;
        // The per-tab live snapshot is newer than the checkpoint; never replace
        // a fresher restored estimate with an older one.
        const alreadyRestored = this.viewerCounter.recentMeasurement?.sampledAt ?? -Infinity;
        if (this.restoredBroadcast !== identity && saved?.range && saved.rangeVersion === 1 &&
            saved.historyProfile === profile && saved.sampledAt > alreadyRestored && saved.sampledAt <= Date.now()) {
          this.viewerCounter.restoreSaved(identity, saved);
        }
        this.restoredBroadcast = identity;
      }
      this.broadcastData = { ...data, profile };
      this.latestGroupWindow = update.groups[0] || this.latestGroupWindow;
      if (this.latestGroupWindow) {
        this.groupRecurrence = analyzeGroupRecurrence(this.latestGroupWindow, data.history);
        for (const record of records) {
          if (applyGroupHistoryBonus(record, this.groupRecurrence)) this.analyzer.auditRecord(record);
        }
      }
      if (this.analyzer.confirmationDirty) {
        this.analyzer.confirmationDirty = false;
        this.syncBroadcast(true);
      }
      this.binder.refresh();
    }).catch((error) => {
      if (this.started && generation === this.startGeneration && this.broadcast === identity) {
        this.lastCheckpoint = -Infinity;
        this.hasCompleteObservation = false;
      }
      console.warn('[Twitch Chat X-Ray] broadcast history', error?.message || String(error));
    });
  }

  interruptChat(reason: string) {
    if (this.chatSince !== null) {
      this.recordEvent({ kind: 'chat-gap', ts: Date.now(), reason });
    }
    this.chatSince = null;
    this.chatClock.pause();
    this.formulaClock.pause();
  }

  interruptViewer(reason: string, now = Date.now()) {
    if (this.lastViewerSample !== null || this.viewerClock.since !== null) {
      this.viewerCounter.history.interrupt(now);
      this.recordEvent({ kind: 'viewer-gap', ts: now, reason });
      this.lastViewerSample = null;
      this.viewerGap = true;
    }
    this.viewerClock.pause();
  }

  interruptObservation(reason: string) {
    this.interruptChat(reason);
    this.interruptViewer(reason);
    this.syncBroadcast(true);
  }

  recordViewerSample({ sample, anomaly, outflow }: NonNullable<ReturnType<ViewerCounterAdjuster['history']['record']>>) {
    if (this.lastViewerSample !== null && sample.ts - this.lastViewerSample > MAX_OBSERVATION_GAP) {
      this.recordEvent({ kind: 'viewer-gap', ts: this.lastViewerSample, resumedAt: sample.ts });
    } else if (this.viewerGap) {
      this.recordEvent({ kind: 'viewer-resume', ts: sample.ts });
    }
    this.lastViewerSample = sample.ts;
    this.viewerGap = false;
    this.viewerClock.observe(sample.ts);
    this.capture?.viewerSamples.push(sample);
    if (outflow) this.recordEvent(outflow);
    if (anomaly) this.recordEvent(anomaly);
    if (outflow || anomaly) this.syncBroadcast(true);
  }

  buildSessionSnapshot() {
    const now = Date.now();
    if (!this.capture) return null;
    const snapshot = this.capture.snapshot(
      now, this.analyzer.session.records, this.getViewerStats(now),
      this.viewerCounter.model?.recentAge != null ? this.viewerCounter.lastMeasurement : this.viewerCounter.model, this.settings
    );
    return completeSessionSnapshot({
      snapshot, broadcast: this.broadcast,
      previousSamples: this.restoredTab ? this.restoredTab.samples ?? [] : null,
      checkpoint: this.broadcastData?.checkpoint,
      confirmed: { ...this.analyzer.confirmed }, bonuses: structuredClone(this.analyzer.bonuses),
      chatIntervals: this.chatClock.snapshot(), viewerIntervals: this.viewerClock.snapshot(),
      events: this.observedEvents, groupRecurrence: this.groupRecurrence,
    });
  }

  downloadSession(previous: boolean) {
    const snapshot = previous ? this.finishedCapture :
      this.capture && this.buildSessionSnapshot();
    if (snapshot) {
      downloadJson(JSON.stringify(snapshot, null, 2), 'twitch-xray-session', snapshot.channel);
    }
  }

  maintenance() {
    try {
      if (this.frozen) return;
      this.handleNavigation();
      const now = Date.now();
      if (this.lastMaintenance !== null && now - this.lastMaintenance > 60000) {
        this.interruptObservation('maintenance-gap');
      }
      this.lastMaintenance = now;
      const identity = broadcastIdentity(this.channel, document);
      if (identity) this.setBroadcast(identity);
      if (!this.settings.recordSession) {
        if (this.capture) {
          this.finishedCapture = this.buildSessionSnapshot();
          this.capture = null;
        }
      } else if (!this.capture && this.channel) {
        this.capture = new SessionCapture(this.channel, now);
      }
      this.capture?.updateSettings(this.settings, now);
      if (this.chatSince === null && this.openSockets.size && this.channel) {
        this.chatSince = now;
      }

      if (this.chatSince !== null) {
        this.chatClock.observe(now);
        if (this.formulaClock.since === null) this.formulaClock.observe(this.chatSince);
        this.formulaClock.observe(now);
      }
      const nextContainer = findMessageContainer();
      if (nextContainer !== this.container) {
        this.statsView.remove();
        this.container = nextContainer ?? null;
      }

      if (this.container) {
        this.statsView.ensure(this.container);
        this.binder.bindRows(this.container);
      }

      this.binder.prunePending();
      this.binder.cleanup();
      this.statsView.update();
      this.viewerCounter.update(this.channel);
      this.syncBroadcast(false, now);
      if (now - this.lastLiveWrite >= LIVE_PERSIST_INTERVAL_MS) {
        this.persistLiveState(now);
      }
      if (this.renderedIdGroups !== this.analyzer.idGroupSnapshot) {
        const hadGroups = this.renderedIdGroups?.count;
        this.renderedIdGroups = this.analyzer.idGroupSnapshot;
        if (hadGroups || this.renderedIdGroups?.count) this.binder.refresh();
      }
      if (this.lastViewerSample !== null && now - this.lastViewerSample > 60000 &&
          !this.viewerGap) {
        this.capture?.events.push({ kind: 'viewer-gap', ts: this.lastViewerSample });
        this.viewerGap = true;
      }
      if (this.capture) {
        const at = Date.now();
        const stats = this.getViewerStats(at);
        this.capture.observe(
          at, stats, this.viewerCounter.model,
          this.analyzer.session.records, this.settings,
          this.getMinute(at, this.viewerCounter.history.samples, stats)
        );
      }
      this.settingsPanel.syncSessionButtons(Boolean(this.capture), Boolean(this.finishedCapture));
      if (this.settings.enableAuditLog) {
        this.settingsPanel.syncAuditCount();
      }
      this.settingsPanel.ensureButton();
      } catch (error) {
      console.warn('[Twitch Chat X-Ray] maintenance error', error);
    }
  }
}
