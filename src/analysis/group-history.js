const MAX_BROADCASTS = 20;
const COORDINATION_BONUS = 10;
const MIN_SHARED_SPEAKERS = 2;
const encoder = new TextEncoder();

async function fingerprint(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest, 0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isSubstantive(text) {
  return Array.from(text).length >= 12 && (text.match(/\p{L}+/gu)?.length ?? 0) >= 3;
}

export async function buildGroupObservation(snapshot, { ts = Date.now() } = {}) {
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

function isRare(phrase, group) {
  return phrase.substantive && phrase.memberIds.length >= MIN_SHARED_SPEAKERS &&
    Number.isFinite(group.outsideAuthorCount) && group.outsideAuthorCount >= 20 &&
    phrase.outsideAuthors <= 2 && phrase.outsideAuthors / group.outsideAuthorCount <= 0.05;
}

function coordinatedAuthors(group, prior) {
  const previousPhrases = new Map(prior.phrases
    .filter((phrase) => isRare(phrase, prior)).map((phrase) => [phrase.fingerprint, phrase]));
  const participants = new Set();
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

export function analyzeGroupRecurrence(observation, previousBroadcasts) {
  const broadcasts = new Map();
  for (const broadcast of previousBroadcasts) {
    if (!broadcast.groupObservations?.length) continue;
    const id = broadcast.broadcastId ?? broadcast.id;
    if (!id) continue;
    if (!broadcasts.has(id) && broadcasts.size >= MAX_BROADCASTS) continue;
    const observations = broadcasts.get(id) ?? [];
    broadcasts.set(id, observations.concat(broadcast.groupObservations));
  }

  const authors = {};
  const groups = observation.groups.map((group) => {
    let bandBroadcasts = 0;
    let sharedMemberBroadcasts = 0;
    let coordinatedBroadcasts = 0;
    const memberIds = new Set(group.memberIds);
    group.memberIds.forEach((id) => {
      authors[id] = { groupBroadcasts: 0, coordinatedBroadcasts: 0 };
    });

    for (const observations of broadcasts.values()) {
      let bandSeen = false;
      let repeatedGroup = false;
      const repeated = new Set();
      const coordinated = new Set();
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
      repeated.forEach((id) => { authors[id].groupBroadcasts += 1; });
      coordinated.forEach((id) => { authors[id].coordinatedBroadcasts += 1; });
    }
    return { from: group.from, to: group.to, bandBroadcasts, sharedMemberBroadcasts, coordinatedBroadcasts };
  });
  return { observedBroadcasts: broadcasts.size, groups, authors };
}

export function applyGroupHistoryBonus(record, recurrence) {
  if (!record.unbadged || record.roleExempt || record.serviceBot ||
      !recurrence?.authors[record.numericUserId]?.coordinatedBroadcasts ||
      record.triggers.some((trigger) => trigger.key === 'group-recurrence')) return;
  record.triggers.push({
    key: 'group-recurrence',
    labelKey: 'trigger.groupRecurrence',
    label: 'Повтор фразы из другого эфира',
    points: COORDINATION_BONUS,
  });
  record.botScore = Math.min(100, record.botScore + COORDINATION_BONUS);
}
