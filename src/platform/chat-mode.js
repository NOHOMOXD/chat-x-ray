// Twitch sends a complete ROOMSTATE on join and individual tags on changes.
export function parseRoomMode(tags) {
  const changes = {};
  for (const [tag, field, min, max] of [
    ['subs-only', 'subscribers', 0, 1],
    ['followers-only', 'followers', -1, Infinity],
    ['slow', 'slow', 0, Infinity],
    ['emote-only', 'emotes', 0, 1],
    ['r9k', 'unique', 0, 1],
  ]) {
    const raw = tags[tag];
    if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value >= min && value <= max) changes[field] = value;
  }
  return changes;
}

export function chatAccess(mode) {
  if (mode?.subscribers === 1) return 'subscribers';
  if (mode?.followers >= 0) return 'followers';
  return mode?.subscribers === 0 && mode.followers === -1 ? 'open' : 'unknown';
}

export function modeProfile(mode) {
  return ['subscribers', 'followers', 'slow', 'emotes', 'unique']
    .map(field => mode?.[field] ?? '?').join('/');
}
