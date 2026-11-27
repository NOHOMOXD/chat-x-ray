import type { AnalyzerRecord } from './analyzer-record.ts';
import { clamp } from './text-analysis.ts';
import { WEIGHTS } from './score-message.ts';

type WaveRecord = Pick<AnalyzerRecord, 'unbadged' | 'roleExempt' | 'waveBoost' | 'botScore' | 'triggers'>;

export function applyWaveBoost(record: WaveRecord) {
  if (!record.unbadged || record.roleExempt || record.waveBoost) {
    return false;
  }
  record.waveBoost = true;
  record.botScore = clamp(record.botScore + WEIGHTS.botWave, 0, 100);
  record.triggers.push({
    key: 'wave',
    labelKey: 'trigger.wave',
    label: 'Волна ботов',
    points: WEIGHTS.botWave,
  });
  return true;
}


