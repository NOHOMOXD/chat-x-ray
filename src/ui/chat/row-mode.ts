import { getMessageActions } from '../../core/message-actions.ts';
import type { SuspicionRecord } from '../../core/chat-session.ts';
import type { Settings } from '../../config/settings-model.ts';

export interface RowRecord extends SuspicionRecord {
  isR9KDuplicate?: boolean;
  spamFlood?: boolean;
  waveBoost?: boolean;
}

type RowSettings = Pick<Settings, 'suspiciousThreshold' | 'suspectAction' | 'r9kAction'>;

export function resolveRowMode(record: RowRecord, settings: RowSettings) {
  const { score: scoreAction, repeat: repeatAction } = getMessageActions(record, settings);
  if (scoreAction === 'hide' || repeatAction === 'hide') return 'hide';
  if (scoreAction === 'mute' || repeatAction === 'mute') return 'mute';
  return 'none';
}

/**
 * Records that received the bot-wave bonus are drawn in red, so the same
 * passive signal a bot wave gives to the header counter is visible on the
 * affected messages too.
 */
export function isWaveRecord(record: RowRecord | null) {
  if (!record || !record.waveBoost) {
    return false;
  }
  const triggers = record.triggers || [];
  for (let i = 0; i < triggers.length; i += 1) {
    if (triggers[i]?.key === 'wave') {
      return true;
    }
  }
  return false;
}

