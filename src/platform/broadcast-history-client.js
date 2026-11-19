import { callStorage } from './browser-api.js';

export const HISTORY_MESSAGE = 'tcx:broadcast-history';

export function createBroadcastHistoryClient() {
  function request(action, args = []) {
    const payload = { type: HISTORY_MESSAGE, action, args };
    const response = globalThis.browser?.runtime?.sendMessage
      ? globalThis.browser.runtime.sendMessage(payload)
      : callStorage(globalThis.chrome.runtime.sendMessage.bind(globalThis.chrome.runtime), payload);
    return response.then((result) => {
      if (!result?.ok) throw new Error(result?.error || 'Broadcast storage is unavailable');
      return result.data;
    });
  }

  return {
    save: (...args) => request('save', args),
    clear: () => request('clear'),
  };
}
