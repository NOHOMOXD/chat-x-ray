import type { AnalyzerRecord } from './analyzer-record.ts';
import { clamp } from './text-analysis.ts';
import { WEIGHTS } from './score-message.ts';

type AgeRecord = Pick<AnalyzerRecord,
  'login' | 'accountAgeDays' | 'accountAgeSource' | 'roleExempt' | 'serviceBot' |
  'unbadged' | 'color' | 'freshAccount' | 'botScore' | 'triggers'>;
interface AccountAgeState<RecordType extends AgeRecord> {
  accountAges: Map<string, number>;
  freshAccountAgeDays: number;
  records: RecordType[];
  auditRecord: (record: RecordType) => void;
}

export function applyAccountAge<RecordType extends AgeRecord>(login: string, ageDays: number, state: AccountAgeState<RecordType>) {
  const key = String(login || '').toLowerCase();
  if (!key || !Number.isFinite(ageDays) || ageDays < 0) {
    return false;
  }
  const previous = state.accountAges.get(key);
  state.accountAges.set(key, ageDays);
  const wantFresh = ageDays < state.freshAccountAgeDays;
  let changed = previous !== ageDays;

  for (const record of state.records) {
    if (record.login !== key) {
      continue;
    }

    record.accountAgeDays = ageDays;
    record.accountAgeSource = 'api';

    if (record.roleExempt || record.serviceBot) {
      continue;
    }
    if (!record.unbadged || record.color) {
      continue;
    }

    let trigger = null;
    for (let t = 0; t < record.triggers.length; t += 1) {
      const candidate = record.triggers[t];
      if (candidate?.key === 'fresh-account') {
        trigger = candidate;
        break;
      }
    }

    if (wantFresh && !trigger) {
      record.freshAccount = true;
      record.botScore = clamp(
        record.botScore + WEIGHTS.freshAccount,
        0,
        100
      );
      // Triggers carry an i18n key; the label is the Russian rendering kept
      // for the JSON audit log and for callers that do not translate.
      record.triggers.push({
        key: 'fresh-account',
        labelKey: 'trigger.freshAccount',
        labelParams: { days: ageDays },
        label: `Новый аккаунт (${ageDays} дн.)`,
        points: WEIGHTS.freshAccount,
      });
      changed = true;
    } else if (!wantFresh && trigger) {
      record.freshAccount = false;
      record.botScore = clamp(
        record.triggers.reduce((total, entry) => total +
          (entry === trigger ? 0 : entry.points), 0),
        0,
        100
      );
      record.triggers = record.triggers.filter(
        (entry) => entry.key !== 'fresh-account'
      );
      changed = true;
    } else if (wantFresh && trigger) {
      record.freshAccount = true;
      const label = `Новый аккаунт (${ageDays} дн.)`;
      if (trigger.label !== label) {
        trigger.label = label;
        trigger.labelKey = 'trigger.freshAccount';
        trigger.labelParams = { days: ageDays };
        changed = true;
      }
    } else if (record.freshAccount) {
      record.freshAccount = false;
      changed = true;
    }
    state.auditRecord(record);
  }

  return changed;
}

