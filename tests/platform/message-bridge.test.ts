import { expect, it, vi } from 'vitest';
import { isValidChatPayload, MessageBridge } from '../../src/platform/message-bridge.ts';

it('accepts trusted events once and removes subscriptions when stopped', () => {
  const receive = vi.fn();
  let token = '';
  const onHandshake = (event: Event) => {
    if (event instanceof CustomEvent) token = JSON.parse(event.detail).token;
  };
  window.addEventListener('twitch-chat-xray:handshake', onHandshake);
  const bridge = new MessageBridge(receive);
  bridge.start();
  const payload = { source: 'twitch-chat-xray', type: 'privmsg', token, sequence: 1, messages: ['hello'] };
  const send = (value: unknown) => window.dispatchEvent(new CustomEvent('twitch-chat-xray:privmsg', {
    detail: JSON.stringify(value),
  }));
  send({ ...payload, token: 'forged' });
  send(payload);
  send(payload);
  expect(receive).toHaveBeenCalledTimes(1);
  expect(receive.mock.calls[0]?.[0].messages).toEqual(['hello']);
  bridge.stop();
  send({ ...payload, sequence: 2 });
  expect(receive).toHaveBeenCalledTimes(1);
  window.removeEventListener('twitch-chat-xray:handshake', onHandshake);
});

it('checks the minimum chat fields and enforces the message length limit', () => {
  expect(isValidChatPayload({ login: 'user', text: 'hello' })).toBe(true);
  expect(isValidChatPayload({ login: 'user', text: '' })).toBe(false);
  expect(isValidChatPayload({ login: 'user', text: 'x'.repeat(2001) })).toBe(false);
  expect(isValidChatPayload({ login: 1, text: 'hello' })).toBe(false);
  expect(isValidChatPayload(null)).toBe(false);
});
