import { afterEach, expect, it, vi } from 'vitest';
import { handleBridgeControl } from '../../src/app/bridge-control-handler.ts';
import type { BridgeControlHost } from '../../src/app/bridge-control-handler.ts';

afterEach(() => vi.useRealTimers());

function host(): BridgeControlHost {
  return {
    channel: 'example', offline: false, chatSince: null, roomSince: 0,
    knownBroadcasts: new Map(), openSockets: new Set(), rooms: new Map(),
    viewerCounter: { update: vi.fn(), history: { recordRaid: vi.fn(() => true) } },
    resetChannel: vi.fn(), setBroadcast: vi.fn(), interruptChat: vi.fn(),
    syncBroadcast: vi.fn(), recordEvent: vi.fn(),
  };
}

it('processes socket and room changes in order and ignores stale socket updates', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const app = host();
  expect(handleBridgeControl(app, { login: 'viewer', text: 'hello' })).toBe(false);
  handleBridgeControl(app, { kind: 'socket-open', socketId: 2 });
  expect(app.chatSince).toBe(1000);
  handleBridgeControl(app, { kind: 'room-state', channel: 'example', socketId: 2, receivedAt: 900, mode: { slow: 5 } });
  handleBridgeControl(app, { kind: 'socket-open', socketId: 1 });
  handleBridgeControl(app, { kind: 'room-state', channel: 'example', socketId: 1, receivedAt: 950, mode: { slow: 10 } });
  expect(app.rooms.get('example')?.mode.slow).toBe(5);
  handleBridgeControl(app, { kind: 'room-state', channel: 'example', socketId: 2, receivedAt: 980, mode: { slow: 15 } });
  expect(app.recordEvent).toHaveBeenCalledWith({ kind: 'room-mode', ts: 980, from: { slow: 5 }, to: { slow: 15 } });
  handleBridgeControl(app, { kind: 'socket-close', socketId: 1 });
  expect(app.interruptChat).not.toHaveBeenCalled();
  handleBridgeControl(app, { kind: 'socket-close', socketId: 2 });
  expect(app.interruptChat).toHaveBeenCalledWith('irc-close');
  expect(app.syncBroadcast).toHaveBeenCalledWith(true);
});
