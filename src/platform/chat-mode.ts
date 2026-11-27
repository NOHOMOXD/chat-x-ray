export interface RoomMode {
  subscribers?: number;
  followers?: number;
  slow?: number;
  emotes?: number;
  unique?: number;
}

// Twitch sends a complete ROOMSTATE on join and individual tags on changes.
export function parseRoomMode(tags: Record<string, unknown>): RoomMode {
  const changes: RoomMode = {};
  const fields: Array<[string, keyof RoomMode, number, number]> = [
    ['subs-only', 'subscribers', 0, 1],
    ['followers-only', 'followers', -1, Infinity],
    ['slow', 'slow', 0, Infinity],
    ['emote-only', 'emotes', 0, 1],
    ['r9k', 'unique', 0, 1],
  ];
  for (const [tag, field, min, max] of fields) {
    const raw = tags[tag];
    if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value >= min && value <= max) changes[field] = value;
  }
  return changes;
}

export function chatAccess(mode: RoomMode | null | undefined) {
  if (mode?.subscribers === 1) return 'subscribers';
  if (mode?.followers !== undefined && mode.followers >= 0) return 'followers';
  return mode?.subscribers === 0 && mode.followers === -1 ? 'open' : 'unknown';
}

export function modeProfile(mode: RoomMode | null | undefined) {
  const fields: Array<keyof RoomMode> = ['subscribers', 'followers', 'slow', 'emotes', 'unique'];
  return fields
    .map(field => mode?.[field] ?? '?').join('/');
}
