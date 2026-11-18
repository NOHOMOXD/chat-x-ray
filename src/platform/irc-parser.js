/*
 * Twitch Chat X-Ray — IRCv3 parser.
 * Dependency-free RFC1459/IRCv3 message parser.
 */

const MAX_TEXT_LENGTH = 2000;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export function decodeTagValue(value) {
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

export function parseTags(rawTags) {
  const tags = Object.create(null);
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

export function parseIrcLine(line) {
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

export function parseBadges(rawBadges) {
  const badgeNames = [];
  const badgeVersions = {};

  if (typeof rawBadges !== 'string' || !rawBadges) {
    return { badges: badgeNames, badgeVersions };
  }

  const parts = rawBadges.split(',');
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i].trim();
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

export function normalizeColor(rawColor) {
  if (typeof rawColor !== 'string' || !COLOR_RE.test(rawColor)) {
    return '';
  }
  return rawColor.toUpperCase();
}

export function parsePrivmsg(line, fallbackTimestamp) {
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

  const prefixNick = parsed.prefix.split('!')[0].toLowerCase();
  const tags = parsed.tags;
  const displayName = tags['display-name'] || prefixNick;
  const login = prefixNick || String(displayName).toLowerCase();
  if (!login) {
    return null;
  }

  const parsedBadges = parseBadges(tags.badges);
  const serverTimestamp = Number.parseInt(tags['tmi-sent-ts'], 10);
  const ts =
    Number.isFinite(serverTimestamp) && serverTimestamp > 0
      ? serverTimestamp
      : Number.isFinite(fallbackTimestamp)
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
    text: text.slice(0, MAX_TEXT_LENGTH),
    channel: channelParam.slice(1).toLowerCase(),
    roomId: tags['room-id'] || '',
    isMod: tags.mod === '1',
    isBroadcaster: parsedBadges.badges.indexOf('broadcaster') !== -1,
  };
}

export function parseFrame(rawFrame, fallbackTimestamp) {
  if (typeof rawFrame !== 'string' || !rawFrame) {
    return [];
  }

  const now = Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : Date.now();
  const lines = rawFrame.split(/\r\n|\n|\r/);
  const messages = [];

  for (let i = 0; i < lines.length; i += 1) {
    const message = parsePrivmsg(lines[i], now);
    if (message) {
      messages.push(message);
    }
  }

  return messages;
}
