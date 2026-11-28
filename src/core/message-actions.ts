import type { Settings } from '../config/settings-model.ts';
import { isSuspicious } from './chat-session.ts';
import type { SuspicionRecord } from './chat-session.ts';

export type ActionRecord = SuspicionRecord & { isR9KDuplicate?: boolean; spamFlood?: boolean };
type ActionSettings = Pick<Settings, 'suspiciousThreshold'> & Partial<Pick<Settings, 'suspectAction' | 'r9kAction'>>;

export function getMessageActions(record: ActionRecord, settings: ActionSettings) {
  return {
    score: isSuspicious(record, settings.suspiciousThreshold) ? settings.suspectAction ?? 'keep' : 'keep',
    repeat: record.isR9KDuplicate || record.spamFlood ? settings.r9kAction ?? 'keep' : 'keep',
  };
}
