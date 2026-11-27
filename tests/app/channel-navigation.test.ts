import { describe, expect, it } from 'vitest';
import { messageChannelAction, navigationAction } from '../../src/app/channel-navigation.ts';

describe('chat and SPA channel changes', () => {
  it('ignores a buffered message from the previous channel only during the grace period', () => {
    const context = { messageChannel: 'old', currentChannel: 'new', previousChannel: 'old', channelChangedAt: 1000 };
    expect(messageChannelAction({ ...context, now: 5999 })).toBe('ignore');
    expect(messageChannelAction({ ...context, now: 6000 })).toBe('switch');
    expect(messageChannelAction({ ...context, messageChannel: '', now: 2000 })).toBe('accept');
  });

  it('keeps a chat-first switch while the URL still points to the previous channel', () => {
    const context = { currentChannel: 'new', lastMessageChannel: 'new', urlLagChannel: 'old' };
    expect(navigationAction({ ...context, urlChannel: 'old' })).toBe('ignore');
    expect(navigationAction({ ...context, urlChannel: 'new' })).toBe('caught-up');
    expect(navigationAction({ ...context, urlChannel: 'another' })).toBe('switch');
  });
});
