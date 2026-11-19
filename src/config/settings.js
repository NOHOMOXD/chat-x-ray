/*
 * Twitch Chat X-Ray — settings model and repository.
 *
 * Normalisation is pure and unit-testable; persistence goes through the
 * cross-browser adapter in ../platform/browser-api.js.
 *
 * Ordering matters: a save() issued before the initial load() has resolved
 * would persist defaults over the user's real settings. The repository
 * therefore serialises every operation behind one load-once promise.
 */
import { normalizeLocale } from '../i18n/i18n.js';
import {
  callStorage,
  getStorageArea,
  onStorageChanged,
} from '../platform/browser-api.js';

export const STORAGE_KEY = 'tcxSettings';

/** Default bot-score threshold, in percent. */
export const DEFAULT_THRESHOLD = 30;

export const DEFAULTS = Object.freeze({
  showBadges: true,
  muteSuspicious: true,
  hideSuspicious: false,
  suspiciousThreshold: DEFAULT_THRESHOLD,
  clientR9K: true,
  r9kAction: 'mute',
  enableAuditLog: false,
  recordSession: false,
  adjustViewerCounter: true,
  accountAgeLookup: false,
  showChatStats: true,
  // '' follows the browser language; 'ru'/'en' pin it.
  language: '',
});

/** Clamp to the slider range (10..100) and round to its 5% step. */
export function clampThreshold(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return DEFAULTS.suspiciousThreshold;
  }
  return Math.min(100, Math.max(10, Math.round(number / 5) * 5));
}

export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const settings = {
    showBadges: source.showBadges !== false,
    muteSuspicious: source.muteSuspicious !== false,
    hideSuspicious: source.hideSuspicious === true,
    suspiciousThreshold: clampThreshold(source.suspiciousThreshold),
    clientR9K: source.clientR9K !== false,
    r9kAction: source.r9kAction === 'hide' ? 'hide' : 'mute',
    enableAuditLog: source.enableAuditLog === true,
    recordSession: source.recordSession === true,
    adjustViewerCounter: source.adjustViewerCounter !== false,
    accountAgeLookup: source.accountAgeLookup === true,
    showChatStats: source.showChatStats !== false,
    language: normalizeLocale(source.language) || '',
  };

  // "Hide" wins over "Mute" when both are somehow set.
  if (settings.hideSuspicious) {
    settings.muteSuspicious = false;
  }

  return settings;
}

export class SettingsRepository {
  /**
   * @param {object|null|undefined} storageArea
   *   undefined -> use the real extension storage; null -> in-memory only.
   */
  constructor(storageArea) {
    this.storageArea =
      storageArea === undefined ? getStorageArea() : storageArea;
    this.loading = null;
    this.queue = Promise.resolve();
  }

  /** Runs `task` only after the initial load has completed. */
  _afterLoad(task) {
    if (!this.loading) {
      this.loading = this._read();
    }
    const next = this.queue.then(() => this.loading).then(() => task());
    // Keep the chain alive even if a task rejects.
    this.queue = next.catch(() => {});
    return next;
  }

  async _read() {
    if (!this.storageArea || typeof this.storageArea.get !== 'function') {
      return normalizeSettings(DEFAULTS);
    }
    try {
      const result = await callStorage(
        this.storageArea.get.bind(this.storageArea),
        STORAGE_KEY
      );
      return normalizeSettings(result ? result[STORAGE_KEY] : null);
    } catch (_error) {
      // A broken storage area must never block the UI: fall back to defaults.
      return normalizeSettings(DEFAULTS);
    }
  }

  /** Load settings. Never rejects; resolves to defaults on failure. */
  load() {
    if (!this.loading) {
      this.loading = this._read();
    }
    return this.loading;
  }

  /**
   * Persist settings. Waits for the initial load first, so a click during the
   * first milliseconds cannot overwrite the stored record with defaults.
   */
  save(settings) {
    const normalized = normalizeSettings(settings);
    return this._afterLoad(async () => {
      if (!this.storageArea || typeof this.storageArea.set !== 'function') {
        return normalized;
      }
      try {
        await callStorage(this.storageArea.set.bind(this.storageArea), {
          [STORAGE_KEY]: normalized,
        });
      } catch (_error) {
        // Persistence failure is non-fatal: the in-memory value still applies.
      }
      return normalized;
    });
  }

  /** Subscribe to external changes; returns an unsubscribe function. */
  subscribe(listener) {
    return onStorageChanged((changes, areaName) => {
      if (areaName !== 'local' || !changes || !changes[STORAGE_KEY]) {
        return;
      }
      listener(normalizeSettings(changes[STORAGE_KEY].newValue));
    });
  }
}
