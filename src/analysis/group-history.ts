interface Phrase {
  fingerprint: string;
  substantive: boolean;
  memberIds: number[];
  messages?: number | undefined;
  authors?: number | undefined;
  outsideAuthors: number;
}

interface Group {
  from: number;
  to: number;
  memberIds: number[];
  r9k?: unknown;
  outsideAuthorCount?: number | undefined;
  phrases: Phrase[];
}

export interface GroupObservation {
  ts: number;
  groups: Group[];
}

export interface PreviousBroadcast {
  broadcastId?: string;
  id?: string;
  groupObservations?: GroupObservation[];
}

interface SourceGroup extends Omit<Group, 'phrases'> {
  phrases?: Array<Omit<Phrase, 'fingerprint' | 'substantive' | 'memberIds'> & {
    text: string;
    memberIds?: number[];
  }>;
}

interface ScoreRecord {
  unbadged: boolean;
  roleExempt?: boolean;
  serviceBot?: boolean;
  numericUserId: number | null | undefined;
  botScore: number;
  triggers: Array<{ key: string; labelKey?: string; label?: string; points?: number }>;
}

interface Recurrence {
  authors: Record<string, { groupBroadcasts: number; coordinatedBroadcasts: number }>;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function savedPhrase(value: unknown): value is Phrase {
  return object(value) && typeof value.fingerprint === 'string' && typeof value.substantive === 'boolean' &&
    numberArray(value.memberIds) && typeof value.outsideAuthors === 'number' && Number.isFinite(value.outsideAuthors) &&
    (value.messages === undefined || typeof value.messages === 'number') &&
    (value.authors === undefined || typeof value.authors === 'number');
}

/** Decode historical groups before using them to calculate recurring behavior. */
export function readGroupObservation(value: unknown): GroupObservation | null {
  if (!object(value) || typeof value.ts !== 'number' || !Number.isFinite(value.ts) || !Array.isArray(value.groups)) return null;
  const groups: Group[] = [];
  for (const group of value.groups) {
    if (!object(group) || typeof group.from !== 'number' || !Number.isFinite(group.from) ||
        typeof group.to !== 'number' || !Number.isFinite(group.to) || !numberArray(group.memberIds)) continue;
    const outsideAuthorCount = typeof group.outsideAuthorCount === 'number' && Number.isFinite(group.outsideAuthorCount)
      ? group.outsideAuthorCount : undefined;
    groups.push({ ...group, from: group.from, to: group.to, memberIds: group.memberIds,
      outsideAuthorCount, phrases: Array.isArray(group.phrases) ? group.phrases.filter(savedPhrase) : [] });
  }
  return { ts: value.ts, groups };
}

const MAX_BROADCASTS = 20;
const COORDINATION_BONUS = 10;
const MIN_SHARED_SPEAKERS = 2;
const encoder = new TextEncoder();

async function fingerprint(text: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest, 0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isSubstantive(text: string) {
  return Array.from(text).length >= 12 && (text.match(/\p{L}+/gu)?.length ?? 0) >= 3;
}

export async function buildGroupObservation(snapshot: { groups: SourceGroup[] }, { ts = Date.now() } = {}) {
  const groups = await Promise.all(snapshot.groups.map(async (group) => {
    const { from, to, memberIds, r9k, outsideAuthorCount } = group;
    const phrases = await Promise.all((group.phrases ?? []).map(async (phrase) => ({
      fingerprint: await fingerprint(phrase.text),
      substantive: isSubstantive(phrase.text),
      memberIds: phrase.memberIds ?? [],
      messages: phrase.messages,
      authors: phrase.authors,
      outsideAuthors: phrase.outsideAuthors,
    })));
    return { from, to, memberIds, r9k, outsideAuthorCount, phrases };
  }));
  return { ts, groups };
}

export function isRare(phrase: Pick<Phrase, 'substantive' | 'memberIds' | 'outsideAuthors'>, group: Pick<Group, 'outsideAuthorCount'>) {
  return phrase.substantive && phrase.memberIds.length >= MIN_SHARED_SPEAKERS &&
    typeof group.outsideAuthorCount === 'number' && Number.isFinite(group.outsideAuthorCount) && group.outsideAuthorCount >= 20 &&
    phrase.outsideAuthors <= 2 && phrase.outsideAuthors / group.outsideAuthorCount <= 0.05;
}

function coordinatedAuthors(group: Group, prior: Group) {
  const previousPhrases = new Map(prior.phrases
    .filter((phrase) => isRare(phrase, prior)).map((phrase) => [phrase.fingerprint, phrase]));
  const participants = new Set<number>();
  for (const phrase of group.phrases) {
    const previous = previousPhrases.get(phrase.fingerprint);
    if (!previous || !isRare(phrase, group)) continue;
    const previousSpeakers = new Set(previous.memberIds);
    const sharedSpeakers = phrase.memberIds.filter((id) => previousSpeakers.has(id));
    if (sharedSpeakers.length >= MIN_SHARED_SPEAKERS) {
      sharedSpeakers.forEach((id) => participants.add(id));
    }
  }
  return participants;
}

export function analyzeGroupRecurrence(observation: GroupObservation, previousBroadcasts: PreviousBroadcast[]) {
  const broadcasts = new Map<string, GroupObservation[]>();
  for (const broadcast of previousBroadcasts) {
    if (!broadcast.groupObservations?.length) continue;
    const id = broadcast.broadcastId ?? broadcast.id;
    if (!id) continue;
    if (!broadcasts.has(id) && broadcasts.size >= MAX_BROADCASTS) continue;
    const observations = broadcasts.get(id) ?? [];
    broadcasts.set(id, observations.concat(broadcast.groupObservations));
  }

  const authors: Recurrence['authors'] = {};
  const groups = observation.groups.map((group) => {
    let bandBroadcasts = 0;
    let sharedMemberBroadcasts = 0;
    let coordinatedBroadcasts = 0;
    const memberIds = new Set(group.memberIds);
    group.memberIds.forEach((id) => {
      authors[id] ??= { groupBroadcasts: 0, coordinatedBroadcasts: 0 };
    });

    for (const observations of broadcasts.values()) {
      let bandSeen = false;
      let repeatedGroup = false;
      const repeated = new Set<number>();
      const coordinated = new Set<number>();
      for (const { groups: previousGroups } of observations) {
        for (const prior of previousGroups) {
          bandSeen ||= group.from <= prior.to && prior.from <= group.to;
          const shared = prior.memberIds.filter((id) => memberIds.has(id));
          shared.forEach((id) => repeated.add(id));
          if (shared.length >= MIN_SHARED_SPEAKERS) {
            repeatedGroup = true;
            coordinatedAuthors(group, prior).forEach((id) => coordinated.add(id));
          }
        }
      }
      bandBroadcasts += Number(bandSeen);
      sharedMemberBroadcasts += Number(repeatedGroup);
      coordinatedBroadcasts += Number(coordinated.size > 0);
      repeated.forEach((id) => { const author = authors[id]; if (author) author.groupBroadcasts += 1; });
      coordinated.forEach((id) => { const author = authors[id]; if (author) author.coordinatedBroadcasts += 1; });
    }
    return { from: group.from, to: group.to, bandBroadcasts, sharedMemberBroadcasts, coordinatedBroadcasts };
  });
  return { observedBroadcasts: broadcasts.size, groups, authors };
}

export function applyGroupHistoryBonus(record: ScoreRecord, recurrence: Recurrence | null | undefined) {
  if (!record.unbadged || record.roleExempt || record.serviceBot ||
      !recurrence?.authors[String(record.numericUserId)]?.coordinatedBroadcasts ||
      record.triggers.some((trigger) => trigger.key === 'group-recurrence')) return;
  record.triggers.push({
    key: 'group-recurrence',
    labelKey: 'trigger.groupRecurrence',
    label: 'Повтор фразы из другого эфира',
    points: COORDINATION_BONUS,
  });
  record.botScore = Math.min(100, record.botScore + COORDINATION_BONUS);
  return true;
}
