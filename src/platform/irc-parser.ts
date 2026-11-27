import { parseRoomMode } from './chat-mode.ts';
/*
 * Twitch Chat X-Ray — IRCv3 parser.
 * Dependency-free RFC1459/IRCv3 message parser.
 */

const MAX_TEXT_LENGTH = 2000;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export function decodeTagValue(value: string | null | undefined) {
  if (typeof value !== 'string' || value.indexOf('\\') === -1) {
    return value || '';
  }

  let output = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value.charAt(i);
    if (char !== '\\') {
      output += char;
      continue;
    }

    const next = value.charAt(i + 1);
    if (!next) {
      output += '\\';
      break;
    }

    i += 1;
    switch (next) {
      case ':':
        output += ';';
        break;
      case 's':
        output += ' ';
        break;
      case '\\':
        output += '\\';
        break;
      case 'r':
        output += '\r';
        break;
      case 'n':
        output += '\n';
        break;
      default:
        output += '\\' + next;
        break;
    }
  }

  return output;
}

export function parseTags(rawTags: unknown) {
  const tags: Record<string, string> = Object.create(null);
  if (typeof rawTags !== 'string' || rawTags.length === 0) {
    return tags;
  }

  const parts = rawTags.split(';');
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) {
      continue;
    }

    const equalsAt = part.indexOf('=');
    if (equalsAt === -1) {
      tags[part] = '';
    } else {
      tags[part.slice(0, equalsAt)] = decodeTagValue(part.slice(equalsAt + 1));
    }
  }

  return tags;
}

export function parseIrcLine(line: unknown) {
  if (typeof line !== 'string') {
    return null;
  }

  let rest = line.replace(/[\r\n]+$/g, '');
  if (!rest) {
    return null;
  }

  let rawTags = '';
  if (rest.charAt(0) === '@') {
    const tagsEnd = rest.indexOf(' ');
    if (tagsEnd === -1) {
      return null;
    }
    rawTags = rest.slice(1, tagsEnd);
    rest = rest.slice(tagsEnd + 1);
  }

  let prefix = '';
  if (rest.charAt(0) === ':') {
    const prefixEnd = rest.indexOf(' ');
    if (prefixEnd === -1) {
      return null;
    }
    prefix = rest.slice(1, prefixEnd);
    rest = rest.slice(prefixEnd + 1);
  }

  let trailing = null;
  const trailingAt = rest.indexOf(' :');
  if (trailingAt !== -1) {
    trailing = rest.slice(trailingAt + 2);
    rest = rest.slice(0, trailingAt);
  }

  const head = rest.trim();
  if (!head) {
    return null;
  }

  const pieces = head.split(/\s+/);
  const command = (pieces.shift() || '').toUpperCase();
  if (!command) {
    return null;
  }

  return {
    tags: parseTags(rawTags),
    prefix,
    command,
    params: pieces,
    trailing,
  };
}

export function parseBadges(rawBadges: unknown) {
  const badgeNames: string[] = [];
  const badgeVersions: Record<string, string | undefined> = {};

  if (typeof rawBadges !== 'string' || !rawBadges) {
    return { badges: badgeNames, badgeVersions };
  }

  const parts = rawBadges.split(',');
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]?.trim();
    if (!entry) {
      continue;
    }

    const slashAt = entry.indexOf('/');
    const name = (slashAt === -1 ? entry : entry.slice(0, slashAt)).toLowerCase();
    if (!name) {
      continue;
    }

    if (badgeNames.indexOf(name) === -1) {
      badgeNames.push(name);
    }

    const version = slashAt === -1 ? '' : entry.slice(slashAt + 1);
    if (version) {
      badgeVersions[name] = version;
    }
  }

  return { badges: badgeNames, badgeVersions };
}

// Channel roles belong to the local room. The official bot badge identifies the account.
interface Badges { badges: string[]; badgeVersions: Record<string, string | undefined>; }

export function mergeBadges(primary: Badges, source: Badges) {
  if (!source.badges.includes('bot-badge') || primary.badges.includes('bot-badge')) return primary;
  return {
    badges: [...primary.badges, 'bot-badge'],
    badgeVersions: { ...primary.badgeVersions, 'bot-badge': source.badgeVersions['bot-badge'] },
  };
}

export function normalizeColor(rawColor: unknown) {
  if (typeof rawColor !== 'string' || !COLOR_RE.test(rawColor)) {
    return '';
  }
  return rawColor.toUpperCase();
}

export function parsePrivmsg(line: unknown, fallbackTimestamp?: number) {
  const parsed = parseIrcLine(line);
  if (!parsed || parsed.command !== 'PRIVMSG') {
    return null;
  }

  const channelParam = parsed.params[0] || '';
  if (channelParam.charAt(0) !== '#' || channelParam.length < 2) {
    return null;
  }

  const text = parsed.trailing === null ? '' : parsed.trailing;
  if (!text.trim()) {
    return null;
  }

  const prefixNick = (parsed.prefix.split('!')[0] || '').toLowerCase();
  const tags = parsed.tags;
  const displayName = tags['display-name'] || prefixNick;
  const login = prefixNick || String(displayName).toLowerCase();
  if (!login) {
    return null;
  }

  const parsedBadges = mergeBadges(parseBadges(tags.badges), parseBadges(tags['source-badges']));
  const serverTimestamp = Number.parseInt(tags['tmi-sent-ts'] || '', 10);
  const ts =
    Number.isFinite(serverTimestamp) && serverTimestamp > 0
      ? serverTimestamp
      : typeof fallbackTimestamp === 'number' && Number.isFinite(fallbackTimestamp)
        ? fallbackTimestamp
        : Date.now();

  return {
    id: tags.id || '',
    userId: tags['user-id'] || '',
    login,
    displayName: String(displayName),
    badges: parsedBadges.badges,
    badgeVersions: parsedBadges.badgeVersions,
    color: normalizeColor(tags.color),
    firstMsg: tags['first-msg'] === '1',
    firstMsgRaw: tags['first-msg'] || '0',
    ts,
    receivedAt: typeof fallbackTimestamp === 'number' && Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : Date.now(),
    serverTimestamp: Number.isFinite(serverTimestamp) && serverTimestamp > 0,
    text: text.slice(0, MAX_TEXT_LENGTH),
    channel: channelParam.slice(1).toLowerCase(),
    roomId: tags['room-id'] || '',
    isMod: tags.mod === '1',
    isBroadcaster: parsedBadges.badges.indexOf('broadcaster') !== -1,
  };
}

function parseRoomState(line: string, receivedAt: number) {
  if (!line.includes(' ROOMSTATE ')) return null;
  const parsed = parseIrcLine(line);
  if (parsed?.command !== 'ROOMSTATE' || !/^#\w+$/.test(parsed.params[0] || '')) return null;
  const mode = parseRoomMode(parsed.tags);
  return Object.keys(mode).length
    ? { kind: 'room-state' as const, receivedAt, channel: (parsed.params[0] || '').slice(1).toLowerCase(), mode }
    : null;
}

export function parseFrame(rawFrame: unknown, fallbackTimestamp?: number) {
  if (typeof rawFrame !== 'string' || !rawFrame) {
    return [];
  }

  const now = typeof fallbackTimestamp === 'number' && Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : Date.now();
  const lines = rawFrame.split(/\r\n|\n|\r/);
  const messages = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || '';
    const message = parsePrivmsg(line, now) || parseRaid(line, now) || parseRoomState(line, now);
    if (message) {
      messages.push(message);
    }
  }

  return messages;
}

function parseRaid(line: string, now: number) {
  if (!line.includes(' USERNOTICE ')) {
    return null;
  }
  const parsed = parseIrcLine(line);
  if (!parsed) return null;
  const { command, params, tags } = parsed;
  if (command !== 'USERNOTICE' || tags['msg-id'] !== 'raid' ||
      !/^#[a-z0-9_]+$/i.test(params[0] || '')) {
    return null;
  }
  const serverTs = Number(tags['tmi-sent-ts']);
  const viewers = Number(tags['msg-param-viewerCount']);
  return {
    kind: 'raid' as const,
    channel: (params[0] || '').slice(1).toLowerCase(),
    id: tags.id || line,
    ts: serverTs > 0 ? serverTs : now,
    viewers: Number.isSafeInteger(viewers) && viewers > 0 ? viewers : null,
  };
}
