/** Decide whether a chat message belongs to the current channel. */
export function messageChannelAction(input: {
  messageChannel: string;
  currentChannel: string;
  previousChannel: string;
  channelChangedAt: number;
  now: number;
}): 'accept' | 'ignore' | 'switch' {
  const { messageChannel, currentChannel, previousChannel, channelChangedAt, now } = input;
  if (!messageChannel || messageChannel === currentChannel) return 'accept';
  if (messageChannel === previousChannel && now - channelChangedAt < 5000) return 'ignore';
  return 'switch';
}

/** IRC can switch before the SPA URL; ignore the stale URL until it catches up. */
export function navigationAction(input: {
  urlChannel: string;
  currentChannel: string;
  lastMessageChannel: string;
  urlLagChannel: string;
}): 'ignore' | 'caught-up' | 'switch' {
  const { urlChannel, currentChannel, lastMessageChannel, urlLagChannel } = input;
  if (!urlChannel) return 'ignore';
  if (urlChannel === currentChannel) return 'caught-up';
  if (lastMessageChannel === currentChannel && urlChannel === urlLagChannel) return 'ignore';
  return 'switch';
}
