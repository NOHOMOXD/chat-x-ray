/*
 * Cross-browser extension API access.
 *
 * Firefox exposes `browser.*` (promise-based) and also aliases `chrome.*`
 * with callback style; Chrome/Edge/Opera expose `chrome.*` only. The extension
 * therefore talks to one small adapter instead of touching globals directly:
 * storage calls are promisified here once, and `lastError` is read in a way
 * that works on both engines (Firefox does not throw when it is unset).
 */

const globalScope = globalThis as typeof globalThis & { browser?: typeof chrome };

export interface SettingsStorageArea {
  get?(key: string | string[] | null, callback: (value: unknown) => void): unknown;
  set?(items: Record<string, unknown>, callback: () => void): unknown;
}

function apiGlobal() {
  if (globalScope.browser && globalScope.browser.runtime) {
    return globalScope.browser;
  }
  if (globalScope.chrome && globalScope.chrome.runtime) {
    return globalScope.chrome;
  }
  // `chrome` may exist without `runtime` in exotic test harnesses.
  return globalScope.chrome || null;
}

/**
 * The storage area, or null when unavailable (unit tests, plain pages).
 * Tests inject their own area into SettingsRepository instead.
 */
export function getStorageArea(): SettingsStorageArea | null {
  const api = apiGlobal();
  try {
    const area = api?.storage?.local;
    if (!area) return null;
    if (api === globalScope.browser) {
      // The promise-based namespace rejects the callback argument used by
      // callStorage. Wrap its methods without passing that argument through.
      return {
        get: (key: string | string[] | null) => area.get(key),
        set: (items: Record<string, unknown>) => area.set(items),
      };
    }
    return {
      get: (key, callback) => area.get(key, callback),
      set: (items, callback) => area.set(items, callback),
    };
  } catch (_error) {
    return null;
  }
}

/**
 * Read the last extension error, if any.
 *
 * Chrome sets `runtime.lastError` inside a callback; reading it from Firefox
 * is harmless because it is simply undefined there.
 */
export function consumeLastError() {
  const api = apiGlobal();
  if (!api || !api.runtime) {
    return null;
  }
  try {
    const error = api.runtime.lastError;
    return error && error.message ? error.message : null;
  } catch (_error) {
    return null;
  }
}

/**
 * Call a callback-style storage method and return a promise.
 *
 * Browsers that return a promise (Firefox `browser.*`, modern Chrome with
 * `chrome.storage` promises) are awaited as-is; otherwise the callback form is
 * used and `lastError` turns into a rejection.
 */
export function callStorage<Argument, Result>(
  method: (argument: Argument, callback: (value: Result) => void) => unknown,
  argument: Argument,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const resolveOnce = (value: Result) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    let result: unknown;
    try {
      result = method(argument, (value) => {
        const error = consumeLastError();
        if (error) rejectOnce(new Error(error));
        else resolveOnce(value);
      });
    } catch (error) {
      rejectOnce(error);
      return;
    }

    if (result && (typeof result === 'object' || typeof result === 'function') &&
        'then' in result && typeof result.then === 'function') {
      (result as PromiseLike<Result>).then(resolveOnce, rejectOnce);
    }
  });
}

/** Subscribe to storage changes; returns an unsubscribe function. */
export function onStorageChanged(listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) {
  const api = apiGlobal();
  if (
    !api ||
    !api.storage ||
    !api.storage.onChanged ||
    typeof api.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }
  api.storage.onChanged.addListener(listener);
  return () => {
    try {
      api.storage.onChanged.removeListener(listener);
    } catch (_error) {
      // Listener already gone.
    }
  };
}
