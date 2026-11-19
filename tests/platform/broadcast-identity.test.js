import { expect, it } from 'vitest';
import { broadcastIdentity, extractBroadcasts, normalizeBroadcast, observePageBroadcasts } from '../../src/platform/broadcast-identity.js';

const started = '2026-11-19T11:00:00Z';

it('accepts only stable identifiers and absolute timestamps associated with a channel', () => {
  document.body.innerHTML = `
    <div data-stream-id="999"></div>
    <div data-channel-login="other" data-stream-id="888"></div>
    <div data-channel-login="channel"><div data-stream-started-at="${started}"></div></div>
  `;
  expect(broadcastIdentity('channel')).toEqual({ channel: 'channel', id: null, startedAt: Date.parse(started) });
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

it('observes a clone without taking ownership of the original response', async () => {
  const response = new Response(JSON.stringify({
    data: { user: { login: 'channel', stream: { id: '100', createdAt: started } } },
  }));
  const original = Promise.resolve(response);
  const page = { fetch: () => original };
  const observed = new Promise((resolve) => observePageBroadcasts(page, resolve));
  expect(page.fetch('https://gql.twitch.tv/gql')).toBe(original);
  expect(await observed).toMatchObject({ channel: 'channel', id: '100' });
  expect(response.bodyUsed).toBe(false);
});
