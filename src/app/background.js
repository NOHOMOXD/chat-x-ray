import { BroadcastHistory } from '../analysis/broadcast-history.js';
import { HISTORY_MESSAGE } from '../platform/broadcast-history-client.js';

// One extension-owned writer serializes updates from all Twitch tabs.
const store = new BroadcastHistory({ locks: null });
const runtime = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== HISTORY_MESSAGE || sender.id !== runtime.id) return false;
  let result;
  if (message.action === 'clear') {
    result = store.clear();
  } else if (message.action === 'save' && message.args?.length === 3) {
    result = store.save(...message.args);
  } else {
    return false;
  }

  result.then(
    (data) => reply({ ok: true, data: data ?? null }),
    (error) => reply({ ok: false, error: error?.message || String(error) }),
  );
  return true;
});
