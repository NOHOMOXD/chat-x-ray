import type { Analyzer } from '../core/analyzer.ts';
import type { ChatWaveEvent } from '../core/analyzer-record.ts';
import type { AccountAgeService } from '../platform/account-age.ts';
import type { MessageBinder } from '../ui/chat/message-binder.ts';
import { isValidChatPayload } from '../platform/message-bridge.ts';
import { WEIGHTS } from '../core/score-message.ts';
import { applyGroupHistoryBonus } from '../analysis/group-history.ts';
import type { analyzeGroupRecurrence } from '../analysis/group-history.ts';
import { messageChannelAction } from './channel-navigation.ts';

export interface ChatMessageHost {
  channel: string;
  previousChannel: string;
  channelChangedAt: number;
  lastMessageChannel: string;
  chatSince: number | null;
  analyzer: Analyzer;
  binder: MessageBinder;
  accountAgeService: AccountAgeService;
  groupRecurrence: ReturnType<typeof analyzeGroupRecurrence> | null;
  resetChannel(channel: string, fromMessage: boolean): void;
  recordEvent(event: ChatWaveEvent): void;
}

/** Process one chat message after control events from the same packet. */
export function processChatMessage(host: ChatMessageHost, message: unknown): boolean {
  if (!isValidChatPayload(message)) return false;
  const messageChannel = message.channel ? String(message.channel).toLowerCase() : '';
  if (messageChannel) host.lastMessageChannel = messageChannel;
  const action = messageChannelAction({
    messageChannel, currentChannel: host.channel, previousChannel: host.previousChannel,
    channelChangedAt: host.channelChangedAt, now: Date.now(),
  });
  if (action === 'ignore') return false;
  if (action === 'switch') host.resetChannel(messageChannel, true);
  if (host.channel && messageChannel && messageChannel !== host.channel) return false;

  const now = Date.now();
  const receivedAt = typeof message.receivedAt === 'number' && Number.isFinite(message.receivedAt)
    ? Math.min(now, message.receivedAt) : now;
  if (host.chatSince === null || host.analyzer.session.records.length === 0) {
    host.chatSince = Math.min(host.chatSince ?? receivedAt, receivedAt);
  }
  const result = host.analyzer.ingest(message);
  if (result.duplicate || !result.record) return false;

  if (applyGroupHistoryBonus(result.record, host.groupRecurrence)) host.analyzer.auditRecord(result.record);
  host.binder.addPending(result.record);
  const { record } = result;
  const eligibleForFreshPoints = record.unbadged && !record.color &&
    !record.roleExempt && !record.serviceBot && record.accountAgeDays === null;
  host.accountAgeService.maybeLookup(record.login, record.botScore,
    eligibleForFreshPoints ? WEIGHTS.freshAccount : 0);
  if (result.waveTriggered) {
    if (result.waveEvent) host.recordEvent(result.waveEvent);
    return true;
  }
  return false;
}
