export const SCORING_RULE_VERSION = 4;
export interface BroadcastProfileSettings {
  suspiciousThreshold: number;
  accountAgeLookup?: boolean;
  roomProfile?: string;
}
export function broadcastProfile(settings: BroadcastProfileSettings) {
  return [SCORING_RULE_VERSION, Number(settings.suspiciousThreshold),
    Number(Boolean(settings.accountAgeLookup)), settings.roomProfile ?? 'unknown'].join(':');
}

export function broadcastKey({ channel, id, startedAt }: { channel: string; id?: string | null; startedAt?: number | null | undefined }) {
  return channel + ':' + (id ? 'id:' + id : 'start:' + startedAt);
}


export function broadcastRelation(er: number, baseline: { low: number | null; high: number | null } | null) {
  if (!Number.isFinite(er) || typeof baseline?.low !== 'number' || !Number.isFinite(baseline.low) || typeof baseline.high !== 'number' || !Number.isFinite(baseline.high)) return null;
  if (er < baseline.low) return 'low';
  if (er > baseline.high) return 'high';
  return 'typical';
}


export interface BroadcastIdentity {
  channel: string;
  id?: string | null;
  startedAt?: number | null;
  firstObservedAt?: number | null;
  updatedAt?: number | null;
}

export function sameBroadcast(a: BroadcastIdentity, b: BroadcastIdentity) {
  if (a.channel !== b.channel) return false;
  if (a.id && b.id) return a.id === b.id;
  return Number.isFinite(a.startedAt) && a.startedAt === b.startedAt;
}

export function startedAt(broadcast: BroadcastIdentity) {
  return broadcast.startedAt ?? broadcast.firstObservedAt ?? broadcast.updatedAt ?? Date.now();
}

export function priorBroadcast(candidate: BroadcastIdentity, identity: BroadcastIdentity) {
  return !sameBroadcast(candidate, identity) && startedAt(candidate) < startedAt(identity);
}


export function isBroadcastIdentity(value: unknown): value is BroadcastIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!('channel' in value) || typeof value.channel !== 'string' || !value.channel) return false;
  if ('id' in value && value.id != null && typeof value.id !== 'string') return false;
  if ('startedAt' in value && value.startedAt != null && typeof value.startedAt !== 'number') return false;
  return ('id' in value && typeof value.id === 'string' && value.id.length > 0) ||
    ('startedAt' in value && typeof value.startedAt === 'number' && Number.isFinite(value.startedAt));
}

export function isBroadcastProfileSettings(value: unknown): value is BroadcastProfileSettings {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'suspiciousThreshold' in value && typeof value.suspiciousThreshold === 'number' &&
    Number.isFinite(value.suspiciousThreshold) &&
    (!('accountAgeLookup' in value) || typeof value.accountAgeLookup === 'boolean') &&
    (!('roomProfile' in value) || typeof value.roomProfile === 'string');
}
