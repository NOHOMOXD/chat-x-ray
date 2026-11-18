import { describe, expect, it } from 'vitest';

import {
  decodeTagValue,
  normalizeColor,
  parseBadges,
  parseFrame,
  parseIrcLine,
  parsePrivmsg,
  parseTags,
} from '../../src/platform/irc-parser.js';

const PRIVMSG =
  '@badge-info=;badges=moderator/1,subscriber/12;color=#FF0000;display-name=JOHN;' +
  'first-msg=1;id=abc-123;mod=1;room-id=42;tmi-sent-ts=1794970575728;user-id=777 ' +
  ':john!john@john.tmi.twitch.tv PRIVMSG #SomeChannel :hello :world';

describe('decodeTagValue', () => {
  it('decodes the IRCv3 escape set in one pass', () => {
    expect(decodeTagValue('a\\:b\\sc\\\\d\\re\\nf')).toBe('a;b c\\d\re\nf');
  });

  it('keeps unknown escapes and returns the input without escapes', () => {
    expect(decodeTagValue('a\\zb')).toBe('a\\zb');
    expect(decodeTagValue('plain')).toBe('plain');
    expect(decodeTagValue(null)).toBe('');
  });
});

describe('parseTags', () => {
  it('splits key=value pairs and treats bare keys as empty', () => {
    const tags = parseTags('a=1;b;c=x\\sy');
    expect(tags.a).toBe('1');
    expect(tags.b).toBe('');
    expect(tags.c).toBe('x y');
  });

  it('returns an empty object for bad input', () => {
    expect(Object.keys(parseTags(''))).toHaveLength(0);
    expect(Object.keys(parseTags(null))).toHaveLength(0);
  });
});

describe('parseIrcLine', () => {
  it('extracts tags, prefix, command, params and trailing', () => {
    const line = parseIrcLine(PRIVMSG);
    expect(line.command).toBe('PRIVMSG');
    expect(line.prefix).toBe('john!john@john.tmi.twitch.tv');
    expect(line.params).toEqual(['#SomeChannel']);
    expect(line.trailing).toBe('hello :world');
    expect(line.tags['display-name']).toBe('JOHN');
  });

  it('rejects malformed input', () => {
    expect(parseIrcLine('')).toBe(null);
    expect(parseIrcLine(null)).toBe(null);
    expect(parseIrcLine('@tags-only')).toBe(null);
    expect(parseIrcLine(':prefix-only')).toBe(null);
  });
});

describe('parseBadges', () => {
  it('deduplicates names, keeping the last version seen', () => {
    const badges = parseBadges('moderator/1,subscriber/12,moderator/2');
    // Names keep first-seen order; a repeated badge overwrites its version.
    expect(badges.badges).toEqual(['moderator', 'subscriber']);
    expect(badges.badgeVersions.moderator).toBe('2');
    expect(badges.badgeVersions.subscriber).toBe('12');
  });

  it('handles empty input', () => {
    expect(parseBadges('').badges).toEqual([]);
    expect(parseBadges(null).badges).toEqual([]);
  });
});

describe('normalizeColor', () => {
  it('accepts only 6-digit hex colours and uppercases them', () => {
    expect(normalizeColor('#ff0000')).toBe('#FF0000');
    expect(normalizeColor('ff0000')).toBe('');
    expect(normalizeColor(null)).toBe('');
  });
});

describe('parsePrivmsg', () => {
  it('maps an IRCv3 PRIVMSG into a structured message', () => {
    const message = parsePrivmsg(PRIVMSG, 1);
    expect(message).toMatchObject({
      id: 'abc-123',
      login: 'john',
      displayName: 'JOHN',
      userId: '777',
      channel: 'somechannel',
      firstMsg: true,
      isMod: true,
      isBroadcaster: false,
      color: '#FF0000',
      text: 'hello :world',
      ts: 1794970575728,
    });
    expect(message.badges).toEqual(['moderator', 'subscriber']);
  });

  it('falls back to the supplied timestamp when the tag is missing', () => {
    const line =
      ':alice!alice@alice.tmi.twitch.tv PRIVMSG #chan :hi there';
    expect(parsePrivmsg(line, 123456).ts).toBe(123456);
  });

  it('rejects non-chat, empty and non-channel messages', () => {
    expect(parsePrivmsg(':tmi.twitch.tv 001 justinfan :Welcome')).toBe(null);
    expect(parsePrivmsg('PING :tmi.twitch.tv')).toBe(null);
    expect(parsePrivmsg(':a!a@a PRIVMSG #chan :   ')).toBe(null);
    expect(parsePrivmsg(':a!a@a PRIVMSG notachannel :hi')).toBe(null);
  });

  it('marks the broadcaster badge', () => {
    const line =
      '@badges=broadcaster/1 :streamer!streamer@streamer PRIVMSG #chan :hello';
    expect(parsePrivmsg(line, 1).isBroadcaster).toBe(true);
  });
});

describe('parseFrame', () => {
  it('parses several lines delivered in one socket frame', () => {
    const frame = [
      ':a!a@a PRIVMSG #chan :first',
      ':b!b@b PRIVMSG #chan :second',
    ].join('\r\n');
    const messages = parseFrame(frame, 1000);
    expect(messages.map((m) => m.login)).toEqual(['a', 'b']);
    expect(messages.every((m) => m.ts === 1000)).toBe(true);
  });

  it('ignores non-PRIVMSG lines inside a frame', () => {
    const frame = 'PING :tmi.twitch.tv\r\n:u!u@u PRIVMSG #c :hi';
    expect(parseFrame(frame, 1)).toHaveLength(1);
  });

  it('returns an empty list for bad input', () => {
    expect(parseFrame('', 1)).toEqual([]);
    expect(parseFrame(null, 1)).toEqual([]);
  });
});
