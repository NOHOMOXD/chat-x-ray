import { expect, it } from 'vitest';
import type { TwitchPage } from '../../src/platform/broadcast-identity.ts';
import { extractBroadcasts, normalizeBroadcast, observePageBroadcasts } from '../../src/platform/broadcast-identity.ts';

const started = '2026-11-19T11:00:00Z';

it('normalizes stable broadcast identifiers and rejects invalid input', () => {
  expect(normalizeBroadcast('Channel', '42', started)).toEqual({ channel: 'channel', id: '42', startedAt: Date.parse(started) });
  expect(normalizeBroadcast('channel', 'wrong', '12:34')).toBeNull();
  expect(normalizeBroadcast('channel/123', '42', started)).toBeNull();
});

it('pairs existing batched Twitch responses with the matching requested channel', () => {
  expect(extractBroadcasts([
    { data: { user: { id: 'channel-owner-id', stream: { id: '100', createdAt: started } } } },
    { data: { user: { login: 'OFFLINE', stream: null } } },
  ], [
    { variables: { channelLogin: 'Some_Channel' } },
    { variables: { channelLogin: 'offline' } },
  ])).toEqual([{ channel: 'some_channel', id: '100', startedAt: Date.parse(started) }]);
});

it.each(['', '?a=1', '#origin=twilight'])('observes a clone at /gql%s without consuming the response', async (suffix) => {
  const response = new Response(JSON.stringify({
    data: { user: { login: 'channel', stream: { id: '100', createdAt: started } } },
  }));
  const original = Promise.resolve(response);
  const page: TwitchPage = { fetch: () => original };
  const observed = new Promise((resolve) => observePageBroadcasts(page, resolve));
  expect(page.fetch('https://gql.twitch.tv/gql' + suffix)).toBe(original);
  expect(await observed).toMatchObject({ channel: 'channel', id: '100' });
  expect(response.bodyUsed).toBe(false);
});
