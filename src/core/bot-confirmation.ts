import type { AnalysisTrigger, AnalyzerRecord, BotConfirmation } from './analyzer-record.ts';
import { BEHAVIOR_TRIGGERS, isSuspicious } from './chat-session.ts';

export type ConfirmationRecord = Pick<AnalyzerRecord, 'numericUserId' | 'ts' | 'botScore' | 'triggers' | 'botConfirmation'> &
  Partial<Pick<AnalyzerRecord, 'roleExempt' | 'serviceBot'>>;

interface ConfirmationState {
  confirmed: Record<string, BotConfirmation>;
  bonuses: Record<string, Record<string, { ts: number; trigger: AnalysisTrigger }>>;
  previousReasons: Map<number, Set<string>>;
  suspiciousThreshold: number;
}

/** Update this message and persisted evidence; return whether persisted data changed. */
export function updateBotConfirmation(record: ConfirmationRecord, state: ConfirmationState): boolean {
  if (record.roleExempt || record.serviceBot || !record.numericUserId) return false;
  const id = record.numericUserId;
  const previous = state.previousReasons.get(id);
  if (!state.confirmed[id] && previous && record.triggers.some(trigger => previous.has(trigger.key)) &&
      !state.bonuses[id]?.returning && !record.triggers.some(trigger => trigger.key === 'returning')) {
    record.triggers.push({ key: 'returning', labelKey: 'trigger.returning', points: 10 });
    record.botScore = Math.min(100, record.botScore + 10);
  }
  let changed = false;
  const earned = state.bonuses[id] ?? {};
  for (const key of ['wave-phrase', 'wave-order', 'group-recurrence', 'returning']) {
    const trigger = record.triggers.find(entry => entry.key === key);
    const previousBonus = earned[key];
    if (trigger && !previousBonus) {
      earned[key] = { ts: record.ts, trigger };
      state.bonuses[id] = earned;
      changed = true;
    } else if (!trigger && previousBonus && previousBonus.ts <= record.ts) {
      record.triggers.push(previousBonus.trigger);
      record.botScore = Math.min(100, record.botScore + previousBonus.trigger.points);
    }
  }
  if (!state.confirmed[id] && isSuspicious(record, state.suspiciousThreshold)) {
    state.confirmed[id] = { ts: record.ts, score: record.botScore, triggers: structuredClone(record.triggers) };
    changed = true;
  }
  const confirmation = state.confirmed[id];
  if (confirmation && record.ts >= confirmation.ts) record.botConfirmation = confirmation;
  return changed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTrigger(value: unknown): value is AnalysisTrigger {
  return isObject(value) && typeof value.key === 'string' && typeof value.points === 'number';
}

function isConfirmation(value: unknown): value is BotConfirmation {
  return isObject(value) && typeof value.ts === 'number' && typeof value.score === 'number' &&
    Array.isArray(value.triggers) && value.triggers.every(isTrigger);
}

/** Restore valid evidence and collect behavioral reasons from earlier broadcasts. */
export function restoreBotConfirmations(
  checkpoint: unknown,
  history: unknown,
  state: Pick<ConfirmationState, 'confirmed' | 'bonuses' | 'previousReasons'>,
): void {
  if (isObject(checkpoint)) {
    if (isObject(checkpoint.confirmed)) {
      for (const [id, confirmation] of Object.entries(checkpoint.confirmed)) {
        if (isConfirmation(confirmation)) state.confirmed[id] = confirmation;
      }
    }
    if (isObject(checkpoint.bonuses)) {
      for (const [id, bonuses] of Object.entries(checkpoint.bonuses)) {
        if (!isObject(bonuses)) continue;
        const valid: Record<string, { ts: number; trigger: AnalysisTrigger }> = {};
        for (const [key, bonus] of Object.entries(bonuses)) {
          if (isObject(bonus) && typeof bonus.ts === 'number' && isTrigger(bonus.trigger)) {
            valid[key] = { ts: bonus.ts, trigger: bonus.trigger };
          }
        }
        state.bonuses[id] = { ...valid, ...state.bonuses[id] };
      }
    }
  }
  state.previousReasons.clear();
  for (const prior of Array.isArray(history) ? history : []) {
    if (!isObject(prior) || !isObject(prior.confirmed)) continue;
    for (const [id, confirmation] of Object.entries(prior.confirmed)) {
      if (!isConfirmation(confirmation)) continue;
      const reasons = state.previousReasons.get(Number(id)) ?? new Set<string>();
      for (const trigger of confirmation.triggers) {
        if (BEHAVIOR_TRIGGERS.has(trigger.key)) reasons.add(trigger.key);
      }
      state.previousReasons.set(Number(id), reasons);
    }
  }
}
