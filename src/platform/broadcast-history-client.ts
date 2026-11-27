import { callStorage } from './browser-api.ts';
import type { BroadcastIdentity, BroadcastProfileSettings } from '../analysis/broadcast-profile.ts';
import type { HistoryUpdate } from '../analysis/broadcast-history-clear.ts';
import { readCheckpoint } from '../analysis/broadcast-checkpoint.ts';
import type { Checkpoint, TimedSample } from '../analysis/broadcast-checkpoint.ts';
import { readGroupObservation } from '../analysis/group-history.ts';
import type { GroupObservation } from '../analysis/group-history.ts';

export const HISTORY_MESSAGE = 'tcx:broadcast-history';

type Action = 'openTab' | 'saveTab' | 'save' | 'clear';
type SendMessage = (message: { type: string; action: Action; args: unknown[] }) => Promise<unknown>;

export interface HistoryBaseline {
  er: number;
  lastEr: number;
  sessions: number;
  low: number | null;
  high: number | null;
}

export interface HistoryItem {
  channel: string;
  id: string;
  startedAt: number | null;
  confirmed: Record<string, unknown>;
  groupObservations: GroupObservation[];
}

export interface HistoryResponse {
  checkpoint: (Checkpoint & { samples: TimedSample[] }) | null;
  baseline: HistoryBaseline | null;
  history: HistoryItem[];
  clearedAt: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sample(value: unknown): value is TimedSample {
  return object(value) && finiteNumber(value.ts) && finiteNumber(value.er);
}

function baseline(value: unknown): HistoryBaseline | null {
  if (value === null) return null;
  if (!object(value) || !finiteNumber(value.er) || !finiteNumber(value.lastEr) ||
      !finiteNumber(value.sessions) || !(value.low === null || finiteNumber(value.low)) ||
      !(value.high === null || finiteNumber(value.high))) throw new Error('Invalid broadcast baseline');
  return { er: value.er, lastEr: value.lastEr, sessions: value.sessions, low: value.low, high: value.high };
}

function historyItem(value: unknown): HistoryItem | null {
  if (!object(value) || typeof value.channel !== 'string' || typeof value.id !== 'string') return null;
  const observations = Array.isArray(value.groupObservations) ? value.groupObservations : [];
  return {
    channel: value.channel,
    id: value.id,
    startedAt: finiteNumber(value.startedAt) ? value.startedAt : null,
    confirmed: object(value.confirmed) ? value.confirmed : {},
    groupObservations: observations.map(readGroupObservation).filter((item): item is GroupObservation => item !== null),
  };
}

function historyResponse(value: unknown): HistoryResponse {
  if (!object(value) || (value.checkpoint !== null && !object(value.checkpoint)) ||
      (value.baseline !== null && !object(value.baseline)) || !Array.isArray(value.history) ||
      !finiteNumber(value.clearedAt)) {
    throw new Error('Invalid broadcast history response');
  }
  const source = value.checkpoint;
  const checkpoint = source ? {
    ...source, ...readCheckpoint(source),
    samples: Array.isArray(source.samples) ? source.samples.filter(sample) : [],
  } : null;
  const history = value.history.map(historyItem).filter((item): item is HistoryItem => item !== null);
  return { checkpoint, baseline: baseline(value.baseline), history, clearedAt: value.clearedAt };
}

function defaultSend(message: { type: string; action: Action; args: unknown[] }): Promise<unknown> {
  const globals = globalThis as typeof globalThis & { browser?: typeof chrome };
  return globals.browser?.runtime?.sendMessage
    ? globals.browser.runtime.sendMessage(message)
    : callStorage((payload, callback) => globals.chrome.runtime.sendMessage(payload, callback), message);
}

export function createBroadcastHistoryClient(send: SendMessage = defaultSend) {
  async function request(action: Action, args: unknown[] = []): Promise<unknown> {
    const result = await send({ type: HISTORY_MESSAGE, action, args });
    if (!object(result) || result.ok !== true) {
      const error = object(result) ? result.error : null;
      throw new Error(error ? String(error) : 'Broadcast storage is unavailable');
    }
    return result.data;
  }

  return {
    openTab: (lease: string, reload: boolean, channel: string) => request('openTab', [lease, reload, channel]),
    async saveTab(lease: string, snapshot: unknown): Promise<boolean> {
      const result = await request('saveTab', [lease, snapshot]);
      if (typeof result !== 'boolean') throw new Error('Invalid tab checkpoint response');
      return result;
    },
    async save(identity: BroadcastIdentity, settings: BroadcastProfileSettings, update: HistoryUpdate): Promise<HistoryResponse> {
      return historyResponse(await request('save', [identity, settings, update]));
    },
    async clear(): Promise<number> {
      const result = await request('clear');
      if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error('Invalid history clear response');
      return result;
    },
  };
}
