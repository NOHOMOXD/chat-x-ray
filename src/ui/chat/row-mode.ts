import { isSuspicious } from '../../core/chat-session.ts';
import type { SuspicionRecord } from '../../core/chat-session.ts';
import type { Settings } from '../../config/settings-model.ts';

export interface RowRecord extends SuspicionRecord {
  isR9KDuplicate?: boolean;
  spamFlood?: boolean;
  waveBoost?: boolean;
}

type RowSettings = Pick<Settings,
  'suspiciousThreshold' | 'hideSuspicious' | 'muteSuspicious' | 'clientR9K' | 'r9kAction'>;

export function resolveRowMode(record: RowRecord, settings: RowSettings) {
  const threshold = settings.suspiciousThreshold;
  const suspicious = isSuspicious(record, threshold);
  let mode: 'none' | 'mute' | 'hide' = 'none';

  if (suspicious) {
    if (settings.hideSuspicious) {
      mode = 'hide';
    } else if (settings.muteSuspicious) {
      mode = 'mute';
    }
  }

  if (
    settings.clientR9K &&
    (record.isR9KDuplicate || record.spamFlood)
  ) {
    if (settings.r9kAction === 'hide') {
      mode = 'hide';
    } else if (mode !== 'hide') {
      mode = 'mute';
    }
  }

  return mode;
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

