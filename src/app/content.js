import { SessionCapture } from '../analysis/session-capture.js';
import { downloadJson } from '../config/bot-logger.js';
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
import { Analyzer, WEIGHTS } from '../core/analyzer.js';
import { chatAccess, modeProfile } from '../platform/chat-mode.js';
import { MessageBinder } from '../ui/chat/message-binder.js';
import { StatsView } from '../ui/chat/stats-view.js';
import { SettingsModal } from '../ui/settings/settings-panel.js';
import {
  SettingsRepository,
  normalizeSettings,
  DEFAULTS,
} from '../config/settings.js';
import { ViewerCounterAdjuster } from '../ui/chat/viewer-counter.js';
import { AccountAgeService } from '../platform/account-age.js';
import { HISTORY_CLEAR_KEY, broadcastProfile, checkpointMerge } from '../analysis/broadcast-history.js';
import { createBroadcastHistoryClient } from '../platform/broadcast-history-client.js';
import { onStorageChanged } from '../platform/browser-api.js';
import { broadcastIdentity, normalizeBroadcast } from '../platform/broadcast-identity.js';
import { coveredDuration, MAX_OBSERVATION_GAP, ObservationClock } from '../analysis/observation-clock.js';
import { describeGroups, findIdGroups, recordsAt } from '../core/id-group-diagnostics.js';
import { analyzeGroupRecurrence, buildGroupObservation, applyGroupHistoryBonus } from '../analysis/group-history.js';
import { isExtensionMutation } from '../ui/shared/ui-utils.js';
import { resolveLocale, setLocale } from '../i18n/i18n.js';

const POST_SOURCE = 'twitch-chat-xray';
const POST_TYPE = 'privmsg';
const SYNC_EVENT = 'twitch-chat-xray:privmsg';
const HANDSHAKE_EVENT = 'twitch-chat-xray:handshake';

/*
 * Per-page-load bridge token.
 *
 * See platform/inject.js: the MAIN world is shared with the whole page, so a
 * plain CustomEvent/postMessage is forgeable. Only payloads carrying this
 * random token are treated as coming from our own WebSocket tap.
 */
function createBridgeToken() {
  const bytes = new Uint8Array(16);
  if (
    typeof crypto !== 'undefined' &&
    crypto &&
    typeof crypto.getRandomValues === 'function'
  ) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const MESSAGE_CONTAINER_SELECTOR =
  '[data-test-selector="chat-scrollable-area__message-container"], ' +
  '.chat-scrollable-area__message-container';

const RESERVED_PATHS = new Set([
  '',
  'directory',
  'search',
  'settings',
  'subscriptions',
  'inventory',
  'wallet',
  'drops',
  'friends',
  'turbo',
  'videos',
  'downloads',
  'jobs',
  'p',
  'legal',
  'privacy',
  'store',
  'creatorcamp',
  'moderator',
]);

function getChannelSlug() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (!parts.length) {
    return '';
  }

  const first = parts[0].toLowerCase();
  if (first === 'popout' || first === 'embed') {
    return (parts[1] || '').toLowerCase();
  }
  if (RESERVED_PATHS.has(first)) {
    return '';
  }
  return first;
}

function isVisible(element) {
  if (!element || !element.isConnected) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    Number(style.opacity) !== 0
  );
}

function findMessageContainer() {
  const nodes = document.querySelectorAll(MESSAGE_CONTAINER_SELECTOR);
  for (let i = 0; i < nodes.length; i += 1) {
    if (isVisible(nodes[i])) {
      return nodes[i];
    }
  }

  const row = document.querySelector(
    '.chat-line__message, [data-test-selector="chat-line-message"]'
  );
  if (row) {
    const candidate = row.closest(MESSAGE_CONTAINER_SELECTOR);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

/** Shallow equality for the normalised settings record. */
function sameSettings(a, b) {
  if (!a || !b) {
    return false;
  }
  const keys = Object.keys(b);
  for (let i = 0; i < keys.length; i += 1) {
    if (a[keys[i]] !== b[keys[i]]) {
      return false;
    }
  }
  return true;
}

function isValidPayload(message) {
  return (
    message &&
    typeof message === 'object' &&
    typeof message.text === 'string' &&
    typeof message.login === 'string' &&
    message.text.length > 0 &&
    message.text.length <= 2000
  );
}

export class ChatXRayApp {
  constructor(settingsRepository) {
    this.settingsRepository = settingsRepository;
    this.settings = normalizeSettings(DEFAULTS);
    // Resolve the interface language before any UI is created, so the first
    // paint already uses the browser language (or the saved choice).
    setLocale(resolveLocale(this.settings.language));
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

    this.lastBridgeSequence = 0;
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
    this.bindScheduled = false;
    this.statsScheduled = false;
    this.started = false;
    this.bridgeToken = createBridgeToken();

    this.binder = new MessageBinder({
      getSettings: () => ({ ...this.settings, getIdGroup: (id) => this.analyzer.idGroupsById.get(id),
        getGroupHistory: (id) => this.groupRecurrence?.authors[id],
        observedBroadcasts: this.groupRecurrence?.observedBroadcasts }),
    });
    this.statsView = new StatsView({
      getStats: () => this.getViewerStats(),
      getSettings: () => this.settings,
    });
    this.viewerCounter = new ViewerCounterAdjuster({
      getBroadcast: () => this.broadcast,
      getSaved: () => this.broadcastData?.checkpoint?.lastRangeModel,
      getStats: (now) => this.getViewerStats(now),
      getMinute: (now, samples, stats) => this.getMinute(now, samples, stats),
      countMessages: (from, to) => this.countMessages(from, to),
      onSample: (accepted) => this.recordViewerSample(accepted),
      onModel: (model) => this.capture?.recordModel(model),
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
      onPreview: (next) => this.applySettings(next, false),
      onCommit: (next) => this.applySettings(next, true),
    });

    this.handleInjectedMessage = this.handleInjectedMessage.bind(this);
    this.handleSyncMessages = this.handleSyncMessages.bind(this);
    this.handleStorageChange = this.handleStorageChange.bind(this);
    this.handleNavigation = this.handleNavigation.bind(this);
    this.handlePageMutation = this.handlePageMutation.bind(this);
  }

  start() {
    if (this.started) {
      return;
    }
    this.started = true;

    window.addEventListener('message', this.handleInjectedMessage);
    window.addEventListener(SYNC_EVENT, this.handleSyncMessages);

    // Hand the token to the MAIN-world tap. inject.js may run before or after
    // this, so answer both the late handshake and inject's request for one.
    window.addEventListener(HANDSHAKE_EVENT + ':request', () => this.announceBridge());
    this.announceBridge();
    this.settingsRepository.subscribe(this.handleStorageChange);
    onStorageChanged((changes, area) => {
      if (area === 'local' && changes[HISTORY_CLEAR_KEY]) {
        this.onHistoryCleared(changes[HISTORY_CLEAR_KEY].newValue);
      }
    });

    this.settingsRepository.load().then((settings) => {
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
    window.addEventListener('popstate', this.handleNavigation);
    window.addEventListener('hashchange', this.handleNavigation);

    // SPA navigation does not fire popstate; a cheap 250 ms poll notices the
    // URL change before Twitch's old viewer count can contaminate the new
    // channel's history. The 1 s maintenance loop stays for DOM work.
    window.setInterval(() => this.handleNavigation(), 250);
    document.addEventListener('freeze', () => {
      this.frozen = true;
      this.interruptObservation('freeze');
    });
    document.addEventListener('resume', () => {
      this.frozen = false;
      this.maintenance();
    });
    window.addEventListener('pagehide', () => this.interruptObservation('pagehide'));
    window.addEventListener('pageshow', () => {
      this.frozen = false;
      this.maintenance();
    });

    window.setInterval(() => this.maintenance(), 1000);
    this.maintenance();
  }

  /** Publish the bridge token to the MAIN-world tap. */
  announceBridge() {
    try {
      window.dispatchEvent(
        new CustomEvent(HANDSHAKE_EVENT, {
          detail: JSON.stringify({
            source: POST_SOURCE,
            token: this.bridgeToken,
          }),
        })
      );
    } catch (_error) {
      // CustomEvent unavailable: the tap stays silent rather than unsafe.
    }
  }

  /** True only for payloads produced by our own tap in this page load. */
  isTrustedPayload(data) {
    return Boolean(data && data.token === this.bridgeToken);
  }

  handleInjectedMessage(event) {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (
      !data ||
      data.source !== POST_SOURCE ||
      data.type !== POST_TYPE ||
      !this.isTrustedPayload(data) ||
      !Array.isArray(data.messages)
    ) {
      return;
    }

    this.processMessages(data);
  }

  handleSyncMessages(event) {
    if (typeof event.detail !== 'string') {
      return;
    }
    let data;
    try {
      data = JSON.parse(event.detail);
    } catch (_error) {
      return;
    }
    if (
      !data ||
      data.source !== POST_SOURCE ||
      data.type !== POST_TYPE ||
      !this.isTrustedPayload(data) ||
      !Array.isArray(data.messages)
    ) {
      return;
    }
    this.processMessages(data);
  }

  processMessages(data) {
    // The synchronous event and postMessage fallback carry the same sequence.
    if (Number.isSafeInteger(data.sequence)) {
      if (data.sequence <= this.lastBridgeSequence) return;
      this.lastBridgeSequence = data.sequence;
    }
    let waveTriggered = false;
    for (let i = 0; i < data.messages.length; i += 1) {
      const message = data.messages[i];
      if (message?.kind === 'broadcast-identity') {
        const identity = normalizeBroadcast(message.channel, message.id, message.startedAt);
        if (!identity) continue;
        this.knownBroadcasts.delete(identity.channel);
        this.knownBroadcasts.set(identity.channel, { identity, seenAt: Date.now() });
        if (this.knownBroadcasts.size > 16) this.knownBroadcasts.delete(this.knownBroadcasts.keys().next().value);
        if (identity.channel === this.channel) this.setBroadcast(identity);
        continue;
      }
      if (message?.kind === 'socket-open' || message?.kind === 'socket-close') {
        if (!Number.isSafeInteger(message.socketId)) {
          continue;
        }
        if (message.kind === 'socket-open') {
          this.openSockets.add(message.socketId);
          this.chatSince ??= Date.now();
        } else {
          if (!this.openSockets.delete(message.socketId)) continue;
          for (const [channel, room] of this.rooms) {
            if (room.socketId !== message.socketId) continue;
            this.rooms.delete(channel);
            if (channel === this.channel) {
              this.roomSince = Date.now();
            }
          }
          if (!this.openSockets.size) {
            this.interruptChat('irc-close');
            this.syncBroadcast(true);
          }
        }
        continue;
      }
      if (message?.kind === 'room-state') {
        if (!this.openSockets.has(message.socketId)) continue;
        const previous = this.rooms.get(message.channel);
        if (previous && previous.socketId > message.socketId) continue;
        this.rooms.set(message.channel, message);
        if (message.channel === this.channel &&
            (previous?.socketId !== message.socketId || modeProfile(previous.mode) !== modeProfile(message.mode))) {
          // A single IRC frame may contain messages on both sides of a change.
          if (previous && modeProfile(previous.mode) !== modeProfile(message.mode)) {
            this.roomSince = Math.min(Date.now(), message.receivedAt);
            this.recordEvent({ kind: 'room-mode', ts: this.roomSince, from: previous.mode, to: message.mode });
          }
          this.viewerCounter.update(this.channel);
        }
        continue;
      }
      if (message?.kind === 'raid') {
        if (message.channel === this.channel && typeof message.id === 'string' &&
            Number.isFinite(message.ts) && this.viewerCounter.history.recordRaid(message)) {
          this.recordEvent(message);
        }
        continue;
      }
      if (!isValidPayload(message)) {
        continue;
      }

      const messageChannel = message.channel
        ? String(message.channel).toLowerCase()
        : '';
      if (messageChannel) {
        this.lastMessageChannel = messageChannel;
        // Chat is authoritative: the IRC socket switches before/with the SPA
        // URL, so the first PRIVMSG is a reliable channel-change signal even
        // if the old page is still mounted.
        if (messageChannel !== this.channel) {
          // Ignore a frame from the socket we just left; Twitch can deliver
          // one or two buffered PRIVMSGs after the channel swap.
          if (
            messageChannel === this.previousChannel &&
            Date.now() - this.channelChangedAt < 5000
          ) {
            continue;
          }
          this.resetChannel(messageChannel, true);
        }
      }

      if (
        this.channel &&
        messageChannel &&
        messageChannel !== this.channel
      ) {
        continue;
      }

      const now = Date.now();
      this.chatSince ??= Number.isFinite(message.receivedAt) ? Math.min(now, message.receivedAt) : now;
      const result = this.analyzer.ingest(message);
      if (result.duplicate || !result.record) {
        continue;
      }

      if (applyGroupHistoryBonus(result.record, this.groupRecurrence)) this.analyzer.auditRecord(result.record);
      this.binder.addPending(result.record);
      const { record } = result;
      const eligibleForFreshPoints = record.unbadged && !record.color &&
        !record.roleExempt && !record.serviceBot && record.accountAgeDays === null;
      this.accountAgeService.maybeLookup(record.login, record.botScore,
        eligibleForFreshPoints ? WEIGHTS.freshAccount : 0);
      if (result.waveTriggered) {
        this.recordEvent(result.waveEvent);
        waveTriggered = true;
      }
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

  handlePageMutation(mutations) {
    let relevant = false;
    for (let i = 0; i < mutations.length; i += 1) {
      if (!isExtensionMutation(mutations[i])) {
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
    this.settingsPanel.ensureMenuRow();
  }

  handleAccountAge(login, ageDays) {
    if (!this.settings.accountAgeLookup) {
      return;
    }
    const changed = this.analyzer.applyAccountAge(login, ageDays);
    if (changed) {
      this.binder.refresh();
      this.statsView.update();
      this.viewerCounter.update(this.channel);
    }
  }

  handleStorageChange(settings) {
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
  applyLanguage(settings) {
    const next = resolveLocale(
      (settings || this.settings || DEFAULTS).language
    );
    if (!setLocale(next)) {
      return false;
    }
    if (document && document.documentElement) {
      document.documentElement.setAttribute('lang', next);
    }
    this.binder.refresh();
    this.statsView.refreshLabels();
    this.viewerCounter.update(this.channel);
    this.settingsPanel.refreshLabels();
    return true;
  }

  handleNavigation() {
    const channel = getChannelSlug();
    if (!channel) {
      return;
    }
    if (channel === this.channel) {
      // The URL caught up with the live chat; the old channel is no longer a
      // plausible lag value.
      this.urlLagChannel = '';
      return;
    }
    // The IRC socket can switch before the SPA URL. In that case the URL still
    // points at the channel we just left; do not revert to it and wipe the new
    // channel's stats. A genuinely different URL is applied immediately.
    if (
      this.lastMessageChannel === this.channel &&
      channel === this.urlLagChannel
    ) {
      return;
    }
    this.resetChannel(channel);
  }

  applySettings(next, persist) {
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

  resetChannel(channel, fromMessage) {
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
    if (this.bindScheduled) {
      return;
    }
    this.bindScheduled = true;
    window.setTimeout(() => {
      this.bindScheduled = false;
      const container = this.container || findMessageContainer();
      if (container) {
        this.binder.bindRows(container);
      }
    }, 80);
  }

  scheduleStats() {
    if (this.statsScheduled) {
      return;
    }
    this.statsScheduled = true;
    window.setTimeout(() => {
      this.statsScheduled = false;
      this.statsView.update();
      this.viewerCounter.update(this.channel);
    }, 250);
  }

  historySettings() {
    return { ...this.settings, roomProfile: modeProfile(this.rooms.get(this.channel)?.mode) };
  }

  getViewerStats(now = Date.now()) {
    const roomMode = this.rooms.get(this.channel)?.mode ?? {};
    const access = chatAccess(roomMode);
    const since = this.chatSince ?? now;
    const mixedMode = this.roomSince > since && now - this.roomSince < 600000 &&
      this.observedEvents.some(event => event.kind === 'room-mode' && event.ts > Math.max(since, now - 600000));
    const windowModes = new Map();
    if (mixedMode) {
      for (const event of this.observedEvents) {
        if (event.kind !== 'room-mode' || event.ts < Math.max(since, now - 600000)) continue;
        for (const mode of [event.from, event.to]) windowModes.set(modeProfile(mode), mode);
      }
    }
    const stats = this.analyzer.getStats(now, since);
    const persistedWaves = this.broadcastData?.checkpoint?.events || [];
    const waves = new Map();
    for (const event of [...persistedWaves, ...this.observedEvents]) {
      if (event.kind === 'chat-wave') waves.set(event.bucketStart, event);
    }
    return {
      ...stats, roomMode, chatAccess: access, windowSince: since, mixedMode, windowModes: [...windowModes.values()],
      waveCount: Math.max(stats.waveCount, waves.size),
      lastWave: stats.lastWave ?? [...waves.values()].at(-1),
      observationMs: coveredDuration([
        ...(this.broadcastData?.checkpoint?.intervals?.chat || []), ...this.chatClock.snapshot(),
      ]),
      tabMs: Math.max(0, now - this.channelChangedAt),
      chatConnected: this.chatSince !== null,
    };
  }

  countMessages(from, to) {
    if (this.chatSince === null || from < this.chatSince) {
      return null;
    }
    return this.analyzer.session.records.reduce((count, record) =>
      count + Number(record.ts > from && record.ts <= to), 0);
  }

  getMinute(now, samples, stats = this.getViewerStats(now)) {
    if (this.chatSince === null || now - this.chatSince < 60000) {
      return null;
    }
    const start = samples.findLast((sample) => sample.ts <= now - 60000);
    const end = samples.at(-1);
    return {
      topAuthorMessages: stats.topAuthorMessages,
      audienceMessages: stats.audienceMessages,
      messages: stats.messagesPerMinute,
      authors: stats.minuteUsers,
      from: start && now - start.ts <= 66000 && end && now - end.ts <= 6000
        ? start.value : null,
      to: end?.value ?? null,
    };
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
    this.viewerClock = new ObservationClock();
    this.observedEvents = [];
  }

  recordEvent(event) {
    this.observedEvents.push(event);
    this.capture?.events.push(event);
  }

  setBroadcast(identity) {
    const normalized = normalizeBroadcast(identity.channel, identity.id, identity.startedAt);
    if (!normalized || normalized.channel !== this.channel) return;
    const { id, startedAt } = normalized;
    const previous = this.broadcast;
    if (startedAt && previous?.startedAt && startedAt < previous.startedAt) return;
    if (previous?.id && id === previous.id && (previous.startedAt || !startedAt)) return;
    if (!id && previous && (!previous.startedAt || previous.startedAt === startedAt)) return;
    const changed = previous && ((id && previous.id && id !== previous.id) ||
      (startedAt && previous.startedAt && startedAt !== previous.startedAt));
    if (changed) this.resetChannel(normalized.channel);

    this.broadcast = { ...normalized, id: normalized.id ?? (changed ? null : previous?.id),
      startedAt: normalized.startedAt ?? (changed ? null : previous?.startedAt),
      firstObservedAt: this.broadcast?.firstObservedAt ?? Date.now() };
    this.broadcastData = null;
    this.lastCheckpoint = -Infinity;
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

  onHistoryCleared(ts) {
    if (!Number.isFinite(ts) || ts <= this.historyClearedAt) return;
    this.historyClearedAt = ts;
    if (ts < this.tabOpenedAt) return;
    this.broadcastData = null;
    this.groupRecurrence = null;
    this.latestGroupWindow = null;
    this.hasCompleteObservation = false;
    this.observedEvents = this.observedEvents.filter((event) => event.ts > ts);
    this.chatClock = new ObservationClock();
    this.viewerClock = new ObservationClock();
    this.chatSince = this.chatSince === null ? null : Math.max(this.chatSince, ts);
    this.viewerCounter.history.reset();
    this.viewerCounter.recent = null;
    this.viewerCounter.lastModel = null;
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
    if (!identity || this.clearingHistory) return;
    const settings = this.historySettings();
    const clearingGeneration = this.historyClearedAt;
    const profile = broadcastProfile(settings);
    const initial = this.broadcastProfile !== profile || this.lastCheckpoint === -Infinity;
    this.broadcastProfile = profile;
    const model = this.viewerCounter.lastModel;
    const compatibleModel = model?.historyProfile === profile && model.chatConnected && model.sampledAt >= this.roomSince;
    const complete = compatibleModel && !model.mixedMode && model.chatAccess !== 'unknown' && model.engagement?.measurable &&
      this.chatClock.since !== null && now - this.chatClock.since >= 600000 &&
      this.viewerClock.since !== null && now - this.viewerClock.since >= 600000 &&
      now - model.sampledAt <= 6000;
    const firstFull = complete && (!this.hasCompleteObservation || initial);
    if (!force && !initial && !firstFull && now - this.lastCheckpoint < 60000) return;
    this.hasCompleteObservation = (this.hasCompleteObservation && !initial) || complete;
    this.lastCheckpoint = now;
    const records = recordsAt(this.analyzer.session.records, now)
      .filter((record) => record.ts > this.historyClearedAt);
    const currentGroups = this.chatSince === null ? null : {
      groups: describeGroups(findIdGroups(records), records, true),
    };
    if (currentGroups) {
      for (const [start, wave] of this.analyzer.pastWaves) {
        if (start < now - 600000 || !wave.rare.length) continue;
        currentGroups.groups.push({
          memberIds: wave.order, from: Math.min(...wave.order), to: Math.max(...wave.order),
          outsideAuthorCount: wave.outsideCount, phrases: wave.rare,
        });
      }
    }
    const update = {
      confirmed: { ...this.analyzer.confirmed }, bonuses: structuredClone(this.analyzer.bonuses),
      intervals: { chat: this.chatClock.snapshot(), viewer: this.viewerClock.snapshot() },
      samples: complete ? [{ ts: now, er: model.engagement.percent }] : [],
      events: structuredClone(this.observedEvents.map(({ atTrigger, ...event }) => event)),
      groups: [],
      lastViewerModel: compatibleModel ? { ...model, input: undefined } : null,
    };
    this.pendingBroadcast = this.pendingBroadcast.then(async () => {
      if (currentGroups) update.groups.push(await buildGroupObservation(currentGroups, { ts: now }));
      const data = await this.broadcastHistory.save(identity, settings, update);
      this.onHistoryCleared(data.clearedAt);
      if (identity !== this.broadcast || profile !== broadcastProfile(this.historySettings()) ||
          (this.historyClearedAt !== clearingGeneration && this.historyClearedAt >= this.tabOpenedAt)) return;
      if (data.checkpoint) {
        const checkpoint = checkpointMerge(data.checkpoint, { events: this.observedEvents });
        this.viewerCounter.history.restoreEvents(checkpoint.events);
        this.analyzer.restoreBotMemory(checkpoint, data.history);
        for (const record of records) this.analyzer.auditRecord(record);
        const saved = checkpoint.lastViewerModel;
        const live = this.viewerCounter.lastModel;
        if (this.restoredBroadcast !== identity && saved?.historyProfile === profile &&
            (!live || (saved.sampledAt > live.sampledAt && saved.sampledAt >= this.roomSince))) {
          this.viewerCounter.lastModel = saved;
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
      if (this.broadcast === identity) {
        this.lastCheckpoint = -Infinity;
        this.hasCompleteObservation = false;
      }
      console.warn('[Twitch Chat X-Ray] broadcast history', error?.message || String(error));
    });
  }

  interruptChat(reason) {
    if (this.chatSince !== null) {
      this.recordEvent({ kind: 'chat-gap', ts: Date.now(), reason });
    }
    this.chatSince = null;
    this.chatClock.pause();
  }

  interruptViewer(reason, now = Date.now()) {
    if (this.lastViewerSample !== null || this.viewerClock.since !== null) {
      this.viewerCounter.history.interrupt(now);
      this.recordEvent({ kind: 'viewer-gap', ts: now, reason });
      this.lastViewerSample = null;
      this.viewerGap = true;
    }
    this.viewerClock.pause();
  }

  interruptObservation(reason) {
    this.interruptChat(reason);
    this.interruptViewer(reason);
    this.syncBroadcast(true);
  }

  recordViewerSample({ sample, anomaly, outflow }) {
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
    const snapshot = this.capture.snapshot(
      now, this.analyzer.session.records, this.getViewerStats(now),
      this.viewerCounter.model?.recentAge != null ? this.viewerCounter.lastModel : this.viewerCounter.model, this.settings
    );
    snapshot.broadcast = this.broadcast;
    const checkpoint = checkpointMerge(this.broadcastData?.checkpoint ?? {}, {
      confirmed: { ...this.analyzer.confirmed }, bonuses: structuredClone(this.analyzer.bonuses),
      intervals: { chat: this.chatClock.snapshot(), viewer: this.viewerClock.snapshot() },
      events: this.observedEvents,
    });
    snapshot.observation = checkpoint.intervals;
    snapshot.broadcastEvents = checkpoint.events;
    if (this.groupRecurrence) {
      snapshot.groupRecurrence = this.groupRecurrence;
    }
    return snapshot;
  }

  downloadSession(previous) {
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

      if (this.chatSince !== null) this.chatClock.observe(now);
      const nextContainer = findMessageContainer();
      if (nextContainer !== this.container) {
        this.statsView.remove();
        this.container = nextContainer;
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
        this.capture.observe(
          at, this.getViewerStats(at), this.viewerCounter.model,
          this.analyzer.session.records, this.settings,
          this.getMinute(at, this.viewerCounter.history.samples)
        );
      }
      this.settingsPanel.syncSessionButtons(Boolean(this.capture), Boolean(this.finishedCapture));
      if (this.settings.enableAuditLog) {
        this.settingsPanel.syncAuditCount();
      }
      this.settingsPanel.ensureButton();
      this.settingsPanel.ensureMenuRow();
    } catch (error) {
      console.warn('[Twitch Chat X-Ray] maintenance error', error);
    }
  }
}

// Auto-boot if running in browser
if (typeof window !== 'undefined') {
  if (!window.__twitchXRayContentBooted) {
    window.__twitchXRayContentBooted = true;

    function boot() {
      if (!document.documentElement) {
        window.setTimeout(boot, 25);
        return;
      }

      const repository = new SettingsRepository();
      const app = new ChatXRayApp(repository);
      app.start();
      window.__twitchXRayApp = app;
    }

    boot();
  }
}
