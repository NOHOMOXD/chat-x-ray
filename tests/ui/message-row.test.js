import { beforeEach, describe, expect, it } from 'vitest';

import {
  MessageRow,
  isWaveRecord,
  resolveRowMode,
} from '../../src/ui/chat/message-row.js';
import { isRowHidden } from '../../src/ui/chat/row-visibility.js';
import { setLocale } from '../../src/i18n/i18n.js';

function makeRow() {
  document.body.innerHTML =
    '<div class="chat-line__message">' +
    '<span class="chat-author__display-name">viewer</span>' +
    '<span class="chat-line__message-body">hello</span>' +
    '</div>';
  return document.querySelector('.chat-line__message');
}

const SETTINGS = {
  showBadges: true,
  muteSuspicious: false,
  hideSuspicious: false,
  suspiciousThreshold: 25,
  clientR9K: false,
  r9kAction: 'mute',
};

function record(overrides = {}) {
  return {
    botScore: 10,
    triggers: [],
    isR9KDuplicate: false,
    spamFlood: false,
    roleExempt: false,
    r9kSimilarity: 0,
    waveBoost: false,
    ...overrides,
  };
}

beforeEach(() => {
  setLocale('en');
  document.body.innerHTML = '';
});

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
    expect(isWaveRecord(record({ waveBoost: true, triggers: [{ key: 'wave' }] }))).toBe(
      true
    );
    expect(isWaveRecord(record({ botScore: 50, triggers: [{ key: 'id-cluster' }] }))).toBe(
      false
    );
    expect(isWaveRecord(null)).toBe(false);
  });
});

describe('MessageRow', () => {
  it('adds a badge for a suspicious account', () => {
    const row = makeRow();
    new MessageRow(row, record({ botScore: 60 })).apply(SETTINGS);

    const badge = row.querySelector('.tcx-bot-badge');
    expect(badge).not.toBe(null);
    expect(badge.textContent).toBe('60 out of 100');
    expect(row.dataset.tcxBotScore).toBe('60');
  });

  it('shows no badge below the threshold', () => {
    const row = makeRow();
    new MessageRow(row, record({ botScore: 20 })).apply(SETTINGS);
    expect(row.querySelector('.tcx-bot-badge')).toBe(null);
  });

  it('respects the showBadges setting', () => {
    const row = makeRow();
    new MessageRow(row, record({ botScore: 60 })).apply({
      ...SETTINGS,
      showBadges: false,
    });
    expect(row.querySelector('.tcx-bot-badge')).toBe(null);
  });

  it('hides the row immediately without animation', () => {
    const row = makeRow();
    new MessageRow(row, record({ botScore: 80 })).apply({
      ...SETTINGS,
      hideSuspicious: true,
    });
    expect(isRowHidden(row)).toBe(true);
    expect(row.classList.contains('tcx-hidden')).toBe(true);
  });

  it('mutes the row with an opacity class', () => {
    const row = makeRow();
    new MessageRow(row, record({ botScore: 40 })).apply({
      ...SETTINGS,
      muteSuspicious: true,
    });
    expect(row.classList.contains('tcx-muted')).toBe(true);
    expect(isRowHidden(row)).toBe(false);
  });

  it('marks wave-boosted rows', () => {
    const row = makeRow();
    new MessageRow(
      row,
      record({ botScore: 45, waveBoost: true, triggers: [{ key: 'wave' }] })
    ).apply(SETTINGS);
    expect(row.dataset.tcxWave).toBe('1');
    expect(row.querySelector('.tcx-bot-badge').classList.contains('tcx-bot-badge--wave')).toBe(
      true
    );
  });

  it('cleans up on destroy so a recycled row is reusable', () => {
    const row = makeRow();
    const view = new MessageRow(row, record({ botScore: 80 }));
    view.apply({ ...SETTINGS, hideSuspicious: true });
    expect(isRowHidden(row)).toBe(true);

    view.destroy();
    expect(isRowHidden(row)).toBe(false);
    expect(row.querySelector('.tcx-bot-badge')).toBe(null);
    expect(row.classList.contains('tcx-hidden')).toBe(false);
    expect(row.dataset.tcxBound).toBe(undefined);
  });
});
