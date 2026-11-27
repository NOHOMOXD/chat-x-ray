import { decodeBridgeControl } from '../platform/bridge-control.ts';
import type { RaidEvent, RoomEvent } from '../platform/bridge-control.ts';
import { modeProfile } from '../platform/chat-mode.ts';
import { normalizeBroadcast } from '../platform/broadcast-identity.ts';
import type { BroadcastIdentity } from '../platform/broadcast-identity.ts';

/** State and operations needed when an event changes the current chat. */
export interface BridgeControlHost {
  channel: string;
  offline: boolean;
  chatSince: number | null;
  roomSince: number;
  knownBroadcasts: Map<string, { identity: BroadcastIdentity; seenAt: number }>;
  openSockets: Set<number>;
  rooms: Map<string, RoomEvent>;
  viewerCounter: { update(channel: string): void; history: { recordRaid(event: RaidEvent): boolean } };
  resetChannel(channel: string): void;
  setBroadcast(identity: BroadcastIdentity): void;
  interruptChat(reason: string): void;
  syncBroadcast(force: boolean): void;
  recordEvent(event: RaidEvent | { [field: string]: unknown; kind: 'room-mode'; ts: number; from: RoomEvent['mode']; to: RoomEvent['mode'] }): void;
}

/** Process a decoded control before later messages in the same IRC packet. */
export function handleBridgeControl(host: BridgeControlHost, input: unknown): boolean {
  const message = decodeBridgeControl(input);
  if (!message) return false;
  if (message.kind === 'invalid') return true;
  if (message.kind === 'broadcast-offline') {
    host.knownBroadcasts.delete(message.channel);
    if (message.channel === host.channel && !host.offline) {
      host.resetChannel(host.channel);
      host.offline = true;
    }
    return true;
  }
  if (message.kind === 'broadcast-identity') {
    const identity = normalizeBroadcast(message.channel, message.id, message.startedAt);
    if (!identity) return true;
    host.knownBroadcasts.delete(identity.channel);
    host.knownBroadcasts.set(identity.channel, { identity, seenAt: Date.now() });
    if (host.knownBroadcasts.size > 16) {
      const oldest = host.knownBroadcasts.keys().next().value;
      if (oldest !== undefined) host.knownBroadcasts.delete(oldest);
    }
    if (identity.channel === host.channel) host.setBroadcast(identity);
    return true;
  }
  if (message.kind === 'socket-open' || message.kind === 'socket-close') {
    if (message.kind === 'socket-open') {
      host.openSockets.add(message.socketId);
      host.chatSince ??= Date.now();
    } else {
      if (!host.openSockets.delete(message.socketId)) return true;
      for (const [channel, room] of host.rooms) {
        if (room.socketId !== message.socketId) continue;
        host.rooms.delete(channel);
        if (channel === host.channel) {
          host.roomSince = Date.now();
        }
      }
      if (!host.openSockets.size) {
        host.interruptChat('irc-close');
        host.syncBroadcast(true);
      }
    }
    return true;
  }
  if (message.kind === 'room-state') {
    if (!host.openSockets.has(message.socketId)) return true;
    const previous = host.rooms.get(message.channel);
    if (previous && previous.socketId > message.socketId) return true;
    host.rooms.set(message.channel, message);
    if (message.channel === host.channel &&
        (previous?.socketId !== message.socketId || modeProfile(previous?.mode) !== modeProfile(message.mode))) {
      // A single IRC frame may contain messages on both sides of a change.
      if (previous && modeProfile(previous?.mode) !== modeProfile(message.mode)) {
        host.roomSince = Math.min(Date.now(), message.receivedAt);
        host.recordEvent({ kind: 'room-mode', ts: host.roomSince, from: previous.mode, to: message.mode });
      }
      host.viewerCounter.update(host.channel);
    }
    return true;
  }
  if (message.kind === 'raid') {
    if (message.channel === host.channel && typeof message.id === 'string' &&
        Number.isFinite(message.ts) && host.viewerCounter.history.recordRaid(message)) {
      host.recordEvent(message);
    }
    return true;
  }
  return false;
}
