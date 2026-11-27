import { BEHAVIOR_TRIGGERS } from '../core/chat-session.ts';
import type { ChatRecord } from '../core/chat-session.ts';

// Version 2 snapshots store only the fields required for rolling counts.
export type PackedLiveRow = [
  id: string,
  timestamp: number,
  userKey: string,
  botScore: number,
  flags: number,
  behavior: string | null,
  command: string | null,
  receivedAt: number,
];

export type SavedLiveRow = [
  id: string,
  timestamp: number,
  userKey: string,
  botScore?: number,
  flags?: number,
  behavior?: string | null,
  command?: string | null,
  receivedAt?: number,
];

export function isSavedLiveRow(value: unknown): value is SavedLiveRow {
  if (!Array.isArray(value) || typeof value[0] !== 'string' ||
      typeof value[1] !== 'number' || !Number.isFinite(value[1]) ||
      typeof value[2] !== 'string') return false;
  for (const index of [3, 4, 7]) {
    if (value[index] !== undefined && typeof value[index] !== 'number') return false;
  }
  for (const index of [5, 6]) {
    if (value[index] != null && typeof value[index] !== 'string') return false;
  }
  return true;
}

export function packLiveRow(record: ChatRecord & { botScore: number }): PackedLiveRow {
  const flags = (record.serviceBot ? 1 : 0) |
    (record.freshAccount ? 2 : 0) |
    (record.roleExempt ? 4 : 0) |
    (record.botConfirmation ? 8 : 0);
  const behavior = record.triggers?.find(trigger => BEHAVIOR_TRIGGERS.has(trigger.key))?.key;
  return [record.id, record.ts, record.userKey, record.botScore, flags,
    behavior ?? null, record.command ?? null, record.receivedAt ?? record.ts];
}

export function unpackLiveRow([id, ts, userKey, botScore, flags, behavior, command, receivedAt]: SavedLiveRow) {
  const bits = flags ?? 0;
  return {
    id, ts, receivedAt, userKey, botScore: botScore ?? 0, command,
    sequence: 1,
    triggers: behavior ? [{ key: behavior }] : [],
    serviceBot: Boolean(bits & 1),
    freshAccount: Boolean(bits & 2),
    roleExempt: Boolean(bits & 4),
    botConfirmation: Boolean(bits & 8),
  };
}
