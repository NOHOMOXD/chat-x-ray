import { normalizeText } from './text-analysis.ts';

interface GroupRecord {
  id?: string | undefined;
  ts?: number;
  receivedAt?: number;
  userKey: string;
  numericUserId?: number | null;
  unbadged?: boolean;
  normalized?: string;
  text?: string;
  isR9KDuplicate?: boolean;
  r9kMatchId?: string | null;
}

interface IdGroup {
  from: number;
  to: number;
  memberIds: number[];
}

export const ID_GROUP_RULE = Object.freeze({
  windowMs: 600000,
  maxWidthExclusive: 50000,
  minAuthors: 6,
});

export function recordsAt<T extends GroupRecord & { ts: number }>(records: T[], ts: number) {
  return records.filter((record) =>
    record.ts > ts - ID_GROUP_RULE.windowMs && record.ts <= ts &&
    (typeof record.receivedAt !== 'number' || !Number.isFinite(record.receivedAt) || record.receivedAt <= ts));
}

export function findIdGroups(records: GroupRecord[]) {
  const ids = [...new Set(records.filter((record) => record.unbadged && typeof record.numericUserId === 'number' &&
    Number.isSafeInteger(record.numericUserId) && record.numericUserId > 0)
    .map((record) => record.numericUserId).filter((id): id is number => typeof id === 'number'))].sort((a, b) => a - b);
  const groups = [];

  while (ids.length >= ID_GROUP_RULE.minAuthors) {
    let bestStart = 0;
    let bestSize = 0;
    let end = 0;
    for (let start = 0; start < ids.length; start += 1) {
      while (end < ids.length && (ids[end] ?? NaN) - (ids[start] ?? NaN) < ID_GROUP_RULE.maxWidthExclusive) {
        end += 1;
      }
      if (end - start > bestSize) {
        bestStart = start;
        bestSize = end - start;
      }
    }
    if (bestSize < ID_GROUP_RULE.minAuthors) break;
    const memberIds = ids.splice(bestStart, bestSize);
    const from = memberIds[0];
    const to = memberIds.at(-1);
    if (from !== undefined && to !== undefined) groups.push({ from, to, memberIds });
  }
  return groups;
}

export function summarizeMatches(subjects: GroupRecord[], context: GroupRecord[], members: Set<string>, includePhraseMembers = false) {
  const byId = new Map<string | null | undefined, GroupRecord>(context.map((record) => [record.id, record]));
  const byPhrase = new Map<string, Set<string>>();
  const matches = { self: 0, member: 0, outside: 0, missing: 0 };
  const phrases = new Map<string, { messages: number; authors: Set<string>; memberIds: Set<number> }>();
  const phraseOf = (record: GroupRecord) => record.normalized ?? normalizeText(record.text || '');

  for (const record of context) {
    if (members.has(record.userKey)) continue;
    const phrase = phraseOf(record);
    if (!phrase) continue;
    if (!byPhrase.has(phrase)) byPhrase.set(phrase, new Set());
    byPhrase.get(phrase)?.add(record.userKey);
  }
  for (const record of subjects) {
    if (record.isR9KDuplicate) {
      const source = byId.get(record.r9kMatchId);
      const category = !source ? 'missing' : source.userKey === record.userKey
        ? 'self' : members.has(source.userKey) ? 'member' : 'outside';
      matches[category] += 1;
    }
    const phrase = phraseOf(record);
    if (!phrase) continue;
    if (!phrases.has(phrase)) phrases.set(phrase, { messages: 0, authors: new Set(), memberIds: new Set() });
    const sample = phrases.get(phrase);
    if (!sample) continue;
    sample.messages += 1;
    sample.authors.add(record.userKey);
    if (includePhraseMembers && typeof record.numericUserId === 'number' && Number.isSafeInteger(record.numericUserId) && record.numericUserId > 0) {
      sample.memberIds.add(record.numericUserId);
    }
  }

  return {
    messages: subjects.length,
    authors: new Set(subjects.map((record) => record.userKey)).size,
    r9k: matches,
    phrases: [...phrases].map(([text, sample]) => ({
      text, messages: sample.messages, authors: sample.authors.size,
      outsideAuthors: byPhrase.get(text)?.size ?? 0,
      ...(includePhraseMembers ? { memberIds: [...sample.memberIds].sort((a, b) => a - b) } : {}),
    })).sort((a, b) => b.authors - a.authors || b.messages - a.messages).slice(0, 10),
  };
}

export function describeGroups(groups: IdGroup[], records: GroupRecord[], includePhraseMembers = false) {
  const uniqueAuthors = includePhraseMembers ? new Set(records.map((record) => record.userKey)).size : 0;
  return groups.map((group) => {
    const ids = new Set(group.memberIds);
    const subjects = records.filter((record) => record.numericUserId != null && ids.has(record.numericUserId));
    const members = new Set(subjects.map((record) => record.userKey));
    return {
      ...group,
      ...summarizeMatches(subjects, records, members, includePhraseMembers),
      ...(includePhraseMembers ? { outsideAuthorCount: uniqueAuthors - members.size } : {}),
    };
  });
}
