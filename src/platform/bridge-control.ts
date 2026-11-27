import type { RoomMode } from './chat-mode.ts';

type SocketEvent = { kind: 'socket-open' | 'socket-close'; socketId: number };
export type RoomEvent = { kind: 'room-state'; socketId: number; channel: string; receivedAt: number; mode: RoomMode };
type BroadcastEvent = { kind: 'broadcast-offline'; channel: string } |
  { kind: 'broadcast-identity'; channel: string; id?: unknown; startedAt?: unknown };
export type RaidEvent = { kind: 'raid'; channel: string; id: string; ts: number; viewers?: number | null };
export type BridgeControl = SocketEvent | RoomEvent | BroadcastEvent | RaidEvent;
export type DecodedControl = { kind: 'invalid' } | BridgeControl | null;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function roomMode(value: unknown): value is RoomMode {
  if (!object(value)) return false;
  return ['subscribers', 'followers', 'slow', 'emotes', 'unique'].every(key =>
    value[key] === undefined || typeof value[key] === 'number' && Number.isFinite(value[key]));
}

/** Null is a chat or unrecognized event; invalid known controls are consumed. */
export function decodeBridgeControl(value: unknown): DecodedControl {
  if (!object(value) || typeof value.kind !== 'string') return null;
  const kind = value.kind;
  if (kind === 'socket-open' || kind === 'socket-close') {
    return typeof value.socketId === 'number' && Number.isSafeInteger(value.socketId)
      ? { ...value, kind, socketId: value.socketId } : { kind: 'invalid' };
  }
  if (kind === 'broadcast-offline') {
    return typeof value.channel === 'string' ? { ...value, kind, channel: value.channel } : { kind: 'invalid' };
  }
  if (kind === 'broadcast-identity') {
    return typeof value.channel === 'string'
      ? { ...value, kind, channel: value.channel, id: value.id, startedAt: value.startedAt }
      : { kind: 'invalid' };
  }
  if (kind === 'room-state') {
    return typeof value.channel === 'string' && typeof value.socketId === 'number' &&
      Number.isSafeInteger(value.socketId) && typeof value.receivedAt === 'number' &&
      Number.isFinite(value.receivedAt) && roomMode(value.mode)
      ? { ...value, kind, channel: value.channel, socketId: value.socketId, receivedAt: value.receivedAt, mode: value.mode }
      : { kind: 'invalid' };
  }
  if (kind === 'raid') {
    if (typeof value.channel !== 'string' || typeof value.id !== 'string' ||
        typeof value.ts !== 'number' || !Number.isFinite(value.ts)) return { kind: 'invalid' };
    const viewers = value.viewers;
    return typeof viewers === 'number' || viewers === null
      ? { ...value, kind, channel: value.channel, id: value.id, ts: value.ts, viewers }
      : { ...value, kind, channel: value.channel, id: value.id, ts: value.ts };
  }
  return null;
}
