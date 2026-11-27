/*
 * Twitch Chat X-Ray — settings model and repository.
 *
 * Normalisation is pure and unit-testable; persistence goes through the
 * cross-browser adapter in ../platform/browser-api.ts.
 *
 * Ordering matters: a save() issued before the initial load() has resolved
 * would persist defaults over the user's real settings. The repository
 * therefore serialises every operation behind one load-once promise.
 */
import {
  callStorage,
  getStorageArea,
  onStorageChanged,
} from '../platform/browser-api.ts';
import type { SettingsStorageArea } from '../platform/browser-api.ts';

export { DEFAULTS, DEFAULT_THRESHOLD, clampThreshold, normalizeSettings } from './settings-model.ts';
import { DEFAULTS, normalizeSettings } from './settings-model.ts';
import type { Settings } from './settings-model.ts';

export const STORAGE_KEY = 'tcxSettings';


export class SettingsRepository {
  private readonly storageArea: SettingsStorageArea | null;
  private loading: Promise<Settings> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * @param {object|null|undefined} storageArea
   *   undefined -> use the real extension storage; null -> in-memory only.
   */
  constructor(storageArea?: SettingsStorageArea | null) {
    this.storageArea =
      storageArea === undefined ? getStorageArea() : storageArea;
    this.loading = null;
    this.queue = Promise.resolve();
  }

  /** Runs `task` only after the initial load has completed. */
  _afterLoad<T>(task: () => Promise<T>): Promise<T> {
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
      const value = result && typeof result === 'object' && STORAGE_KEY in result
        ? result[STORAGE_KEY] : null;
      return normalizeSettings(value);
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
  save(settings: unknown) {
    const normalized = normalizeSettings(settings);
    return this._afterLoad(async () => {
      if (!this.storageArea || typeof this.storageArea.set !== 'function') {
        return normalized;
      }
      try {
        const area = this.storageArea;
        await callStorage((items, done) => area.set?.(items, () => done(undefined)), {
          [STORAGE_KEY]: normalized,
        });
      } catch (_error) {
        // Persistence failure is non-fatal: the in-memory value still applies.
      }
      return normalized;
    });
  }

  /** Subscribe to external changes; returns an unsubscribe function. */
  subscribe(listener: (settings: Settings) => void) {
    return onStorageChanged((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local' || !changes || !changes[STORAGE_KEY]) {
        return;
      }
      listener(normalizeSettings(changes[STORAGE_KEY]?.newValue));
    });
  }
}
