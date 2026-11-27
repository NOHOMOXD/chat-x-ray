import { isBroadcastIdentity, isBroadcastProfileSettings } from '../analysis/broadcast-profile.ts';
import { isHistoryUpdate } from '../analysis/broadcast-history-clear.ts';
import { BroadcastHistory } from '../analysis/broadcast-history.ts';
import { TabCheckpoints } from '../platform/tab-checkpoints.ts';
import { HISTORY_MESSAGE } from '../platform/broadcast-history-client.ts';

// One extension-owned writer serializes updates from all Twitch tabs.
const store = new BroadcastHistory({ locks: null });
const globals = globalThis as typeof globalThis & { browser?: typeof chrome };
const api = globals.browser?.runtime ? globals.browser : globals.chrome;
const runtime = api.runtime;
const tabs = new TabCheckpoints(api.storage.session ?? api.storage.local, api === globals.browser);
// Clean expired snapshots once per background lifetime before handling tab operations.
tabs.pruneExpired().catch((error: unknown) => console.warn('[Twitch Chat X-Ray] checkpoint cleanup', error));
api.tabs?.onRemoved?.addListener(id => { tabs.close(id).catch(() => {}); });
if (!api.storage.session) runtime.onStartup?.addListener(() => { tabs.clear().catch(() => {}); });
runtime.onMessage.addListener((input: unknown, sender, reply) => {
  if (typeof input !== 'object' || input === null || !('type' in input) ||
      input.type !== HISTORY_MESSAGE || sender.id !== runtime.id) return false;
  const message = input as { action?: unknown; args?: unknown };
  const args: unknown[] = Array.isArray(message.args) ? message.args : [];
  let result;
  if (message.action === 'clear') {
    result = tabs.clear().then(() => store.clear());
  } else if ((message.action === 'openTab' || message.action === 'saveTab') &&
      typeof sender.tab?.id === 'number' && Number.isInteger(sender.tab.id) &&
      sender.frameId === 0 && typeof args[0] === 'string' &&
      (message.action !== 'openTab' || typeof args[2] === 'string')) {
    const [lease, value] = args;
    result = message.action === 'openTab' && typeof args[2] === 'string' ? tabs.open(sender.tab.id, lease, value === true, args[2])
      : tabs.save(sender.tab.id, lease, value);
  } else if (message.action === 'save' && args.length === 3 &&
      isBroadcastIdentity(args[0]) && isBroadcastProfileSettings(args[1]) && isHistoryUpdate(args[2])) {
    result = store.save(args[0], args[1], args[2]);
  } else {
    return false;
  }

  result.then(
    (data: unknown) => reply({ ok: true, data: data ?? null }),
    (error: unknown) => reply({
      ok: false,
      error: error && typeof error === 'object' && 'message' in error && error.message
        ? error.message : String(error),
    }),
  );
  return true;
});
