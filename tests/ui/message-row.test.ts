import { describe, expect, it } from 'vitest';
import type { RowRecord } from '../../src/ui/chat/row-mode.ts';

import {
  isWaveRecord,
  resolveRowMode,
} from '../../src/ui/chat/row-mode.ts';

const SETTINGS = {
  showBadges: true,
  muteSuspicious: false,
  hideSuspicious: false,
  suspiciousThreshold: 25,
  clientR9K: false,
  r9kAction: 'mute',
} as const;

function record(overrides: Partial<RowRecord> = {}) {
  return {
    botScore: 10,
    triggers: [{ key: 'self-repeat' }],
    isR9KDuplicate: false,
    spamFlood: false,
    roleExempt: false,
    r9kSimilarity: 0,
    waveBoost: false,
    ...overrides,
  };
}

describe('resolveRowMode', () => {
  it('returns none for a clean message', () => {
    expect(resolveRowMode(record({ botScore: 10 }), SETTINGS)).toBe('none');
  });

  it('mutes or hides accounts at/above the threshold', () => {
    expect(
      resolveRowMode(record({ botScore: 25 }), { ...SETTINGS, muteSuspicious: true })
    ).toBe('mute');
    expect(
      resolveRowMode(record({ botScore: 25 }), { ...SETTINGS, hideSuspicious: true })
    ).toBe('hide');
  });

  it('does not act below the threshold', () => {
    expect(
      resolveRowMode(record({ botScore: 20 }), { ...SETTINGS, hideSuspicious: true })
    ).toBe('none');
  });

  it('applies R9K actions when enabled', () => {
    const r9k = record({ botScore: 0, isR9KDuplicate: true });
    expect(
      resolveRowMode(r9k, { ...SETTINGS, clientR9K: true, r9kAction: 'hide' })
    ).toBe('hide');
    expect(
      resolveRowMode(r9k, { ...SETTINGS, clientR9K: true, r9kAction: 'mute' })
    ).toBe('mute');
    expect(resolveRowMode(r9k, { ...SETTINGS, clientR9K: false })).toBe('none');
  });

  it('treats a character flood like an R9K duplicate', () => {
    expect(
      resolveRowMode(record({ botScore: 0, spamFlood: true }), {
        ...SETTINGS,
        clientR9K: true,
        r9kAction: 'hide',
      })
    ).toBe('hide');
  });

  it('lets a hide action win over mute, whichever rule asked for it', () => {
    // Hide-suspicious + R9K mute: the account is R9K-only (score 0), so the
    // suspicious rule does not apply and R9K's explicit mute stands.
    expect(
      resolveRowMode(record({ botScore: 0, isR9KDuplicate: true }), {
        ...SETTINGS,
        hideSuspicious: true,
        clientR9K: true,
        r9kAction: 'mute',
      })
    ).toBe('mute');

    // Hide-suspicious + R9K hide: hide anywhere wins.
    expect(
      resolveRowMode(record({ botScore: 0, isR9KDuplicate: true }), {
        ...SETTINGS,
        hideSuspicious: true,
        clientR9K: true,
        r9kAction: 'hide',
      })
    ).toBe('hide');

    // Suspicious account under mute-only R9K stays hidden by the hide rule.
    expect(
      resolveRowMode(record({ botScore: 50, isR9KDuplicate: true }), {
        ...SETTINGS,
        hideSuspicious: true,
        clientR9K: true,
        r9kAction: 'mute',
      })
    ).toBe('hide');
  });
});

describe('isWaveRecord', () => {
  it('detects the wave bonus', () => {
    expect(isWaveRecord(record({ waveBoost: true, triggers: [{ key: 'wave' }, { key: 'self-repeat' }] }))).toBe(
      true
    );
    expect(isWaveRecord(record({ botScore: 50, triggers: [{ key: 'id-cluster' }] }))).toBe(
      false
    );
    expect(isWaveRecord(null)).toBe(false);
  });
});
