import { normalizeText } from './text-analysis.js';

export const ID_GROUP_RULE = Object.freeze({
  windowMs: 600000,
  maxWidthExclusive: 50000,
  minAuthors: 6,
});

export function recordsAt(records, ts) {
  return records.filter((record) =>
    record.ts > ts - ID_GROUP_RULE.windowMs && record.ts <= ts &&
    (!Number.isFinite(record.receivedAt) || record.receivedAt <= ts));
}

export function findIdGroups(records) {
  const ids = [...new Set(records.filter((record) => record.unbadged &&
    Number.isSafeInteger(record.numericUserId) && record.numericUserId > 0)
    .map((record) => record.numericUserId))].sort((a, b) => a - b);
  const groups = [];

  while (ids.length >= ID_GROUP_RULE.minAuthors) {
    let bestStart = 0;
    let bestSize = 0;
    let end = 0;
    for (let start = 0; start < ids.length; start += 1) {
      while (end < ids.length && ids[end] - ids[start] < ID_GROUP_RULE.maxWidthExclusive) {
        end += 1;
      }
      if (end - start > bestSize) {
        bestStart = start;
        bestSize = end - start;
      }
    }
    if (bestSize < ID_GROUP_RULE.minAuthors) break;
    const memberIds = ids.splice(bestStart, bestSize);
    groups.push({ from: memberIds[0], to: memberIds.at(-1), memberIds });
  }
  return groups;
}

export function summarizeMatches(subjects, context, members, includePhraseMembers = false) {
  const byId = new Map(context.map((record) => [record.id, record]));
  const byPhrase = new Map();
  const matches = { self: 0, member: 0, outside: 0, missing: 0 };
  const phrases = new Map();
  const phraseOf = (record) => record.normalized ?? normalizeText(record.text || '');

  for (const record of context) {
    if (members.has(record.userKey)) continue;
    const phrase = phraseOf(record);
    if (!phrase) continue;
    if (!byPhrase.has(phrase)) byPhrase.set(phrase, new Set());
    byPhrase.get(phrase).add(record.userKey);
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
    sample.messages += 1;
    sample.authors.add(record.userKey);
    if (includePhraseMembers && Number.isSafeInteger(record.numericUserId) && record.numericUserId > 0) {
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

export function describeGroups(groups, records, includePhraseMembers = false) {
  const uniqueAuthors = includePhraseMembers ? new Set(records.map((record) => record.userKey)).size : 0;
  return groups.map((group) => {
    const ids = new Set(group.memberIds);
    const subjects = records.filter((record) => ids.has(record.numericUserId));
    const members = new Set(subjects.map((record) => record.userKey));
    return {
      ...group,
      ...summarizeMatches(subjects, records, members, includePhraseMembers),
      ...(includePhraseMembers ? { outsideAuthorCount: uniqueAuthors - members.size } : {}),
    };
  });
}
