import { afterEach, expect, it, vi } from 'vitest';
import { processChatMessage } from '../../src/app/process-chat-message.ts';
import type { ChatMessageHost } from '../../src/app/process-chat-message.ts';
import { Analyzer } from '../../src/core/analyzer.ts';
import { MessageBinder } from '../../src/ui/chat/message-binder.ts';
import { AccountAgeService } from '../../src/platform/account-age.ts';
import { normalizeSettings } from '../../src/config/settings-model.ts';

afterEach(() => vi.useRealTimers());

it('ignores a late message from the old channel and binds an accepted message once', () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const binder = new MessageBinder({ getSettings: () => normalizeSettings({}) });
  const addPending = vi.spyOn(binder, 'addPending');
  const age = new AccountAgeService({ getSettings: () => ({ accountAgeLookup: false }) });
  const app: ChatMessageHost = {
    channel: 'current', previousChannel: 'old', channelChangedAt: 99000,
    lastMessageChannel: '', chatSince: null, analyzer: new Analyzer(), binder,
    accountAgeService: age, groupRecurrence: null,
    resetChannel: vi.fn(), recordEvent: vi.fn(),
  };
  const late = { id: 'late', login: 'viewer', text: 'hello', channel: 'old', ts: 100000 };
  expect(processChatMessage(app, { ...late, channel: {} })).toBe(false);
  expect(app.lastMessageChannel).toBe('');
  expect(app.resetChannel).not.toHaveBeenCalled();
  expect(processChatMessage(app, late)).toBe(false);
  expect(addPending).not.toHaveBeenCalled();
  const current = { ...late, id: 'current', channel: 'current', receivedAt: 99900 };
  expect(processChatMessage(app, current)).toBe(false);
  expect(app.chatSince).toBe(99900);
  expect(addPending).toHaveBeenCalledTimes(1);
  expect(processChatMessage(app, current)).toBe(false);
  expect(addPending).toHaveBeenCalledTimes(1);
});
