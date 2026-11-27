import { beforeEach, describe, expect, it } from 'vitest';

import {
  botHue,
  formatNumber,
  formatViewerRange,
  formatViewerRangeCompact,
  isAlertState,
  setAttributeIfChanged,
  setTextIfChanged,
} from '../../src/ui/shared/ui-utils.ts';
import { setLocale } from '../../src/i18n/i18n.ts';

beforeEach(() => {
  setLocale('ru');
  document.body.innerHTML = '';
});

describe('setTextIfChanged', () => {
  it('writes once and reports whether it changed', () => {
    const node = document.createElement('span');
    expect(setTextIfChanged(node, 'a')).toBe(true);
    expect(setTextIfChanged(node, 'a')).toBe(false);
    expect(setTextIfChanged(node, 'b')).toBe(true);
    expect(node.textContent).toBe('b');
  });

  it('is a no-op for a missing node', () => {
    expect(setTextIfChanged(null, 'x')).toBe(false);
  });
});

describe('setAttributeIfChanged', () => {
  it('sets, skips identical values and removes on null', () => {
    const node = document.createElement('span');
    expect(setAttributeIfChanged(node, 'aria-label', 'a')).toBe(true);
    expect(setAttributeIfChanged(node, 'aria-label', 'a')).toBe(false);
    expect(node.getAttribute('aria-label')).toBe('a');
    expect(setAttributeIfChanged(node, 'aria-label', null)).toBe(true);
    expect(node.hasAttribute('aria-label')).toBe(false);
  });
});

describe('number formatting', () => {
  it('groups digits per locale', () => {
    expect(formatNumber(1653, 'ru-RU').replace(/\u00A0/g, ' ')).toBe('1 653');
    expect(formatNumber(15400, 'ru-RU').replace(/\u00A0/g, ' ')).toBe('15 400');
    expect(formatNumber(1653, 'en-US')).toBe('1,653');
    expect(formatNumber(Number.NaN, 'en-US')).toBe('0');
  });

  it('builds a compact range with locale suffixes', () => {
    expect(formatViewerRangeCompact({ low: 8000, high: 12500 }, 'ru-RU')).toBe(
      '8–12,5 тыс.'
    );
    expect(formatViewerRangeCompact({ low: 8000, high: 12500 }, 'en-US')).toBe(
      '8–12.5K'
    );
    expect(formatViewerRangeCompact({ low: 640, high: 900 }, 'ru-RU')).toBe(
      '640–900'
    );
    expect(formatViewerRange({ low: 14, high: 14 }, 'ru')).toBe('≈14');
    expect(formatViewerRangeCompact({ low: 14, high: 14 }, 'ru')).toBe('14');
    expect(formatViewerRangeCompact({ low: 1010, high: 1020 }, 'en')).toBe('1K');
    expect(formatViewerRangeCompact(null)).toBe('');
  });
});

describe('botHue', () => {
  it('moves from gold at the threshold to red at 100', () => {
    expect(botHue(25, 25)).toBe(52);
    expect(botHue(100, 25)).toBe(0);
    expect(botHue(150, 25)).toBe(0);
    expect(botHue(0, 25)).toBe(52);
  });
});

describe('isAlertState', () => {
  it('is true for a bot wave', () => {
    expect(isAlertState({ isBotWave: true })).toBe(true);
  });

  it('is true for warn and critical verdicts', () => {
    expect(isAlertState({ verdict: { level: 'warn' } })).toBe(true);
    expect(isAlertState({ verdict: { level: 'critical' } })).toBe(true);
    expect(isAlertState({ verdict: { level: 'ok' } })).toBe(false);
  });

  it('compares the suspicious share against the threshold', () => {
    expect(isAlertState({ threshold: 25, suspiciousShare: 0.3 })).toBe(true);
    expect(isAlertState({ threshold: 25, suspiciousShare: 0.1 })).toBe(false);
    expect(isAlertState({ threshold: 25, suspiciousShare: 0 })).toBe(false);
  });

  it('is false for empty input', () => {
    expect(isAlertState(null)).toBe(false);
    expect(isAlertState({})).toBe(false);
  });
});

it.each(['ru', 'en'])('uses exact %s numbers when compact rounding exceeds Twitch', (locale) => {
  const range = { low: 14500, high: 28296 };
  expect(formatViewerRangeCompact(range, locale, 28296)).toBe(
    formatViewerRange(range, locale).replace(' – ', '–'),
  );
  expect(formatViewerRangeCompact({ low: 28296, high: 28296 }, locale, 28296)).toBe(
    formatViewerRange({ low: 28296, high: 28296 }, locale).slice(1),
  );
});
