/*
 * Cross-browser extension API access.
 *
 * Firefox exposes `browser.*` (promise-based) and also aliases `chrome.*`
 * with callback style; Chrome/Edge/Opera expose `chrome.*` only. The extension
 * therefore talks to one small adapter instead of touching globals directly:
 * storage calls are promisified here once, and `lastError` is read in a way
 * that works on both engines (Firefox does not throw when it is unset).
 */

const globalScope = typeof globalThis !== 'undefined' ? globalThis : self;

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
export function getStorageArea() {
  const api = apiGlobal();
  try {
    const area = api?.storage?.local;
    if (!area) return null;
    if (api === globalScope.browser) {
      // The promise-based namespace rejects the callback argument used by
      // callStorage. Wrap its methods without passing that argument through.
      return {
        get: (key) => area.get(key),
        set: (items) => area.set(items),
      };
    }
    return area;
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
export function callStorage(method, argument) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      fn(value);
    };

    let result;
    try {
      result = method(argument, (value) => {
        const error = consumeLastError();
        if (error) {
          finish(reject, new Error(error));
          return;
        }
        finish(resolve, value);
      });
    } catch (error) {
      finish(reject, error);
      return;
    }

    if (result && typeof result.then === 'function') {
      result.then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error)
      );
    }
  });
}

/** Subscribe to storage changes; returns an unsubscribe function. */
export function onStorageChanged(listener) {
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
