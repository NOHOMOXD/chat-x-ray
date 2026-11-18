import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCounterParts,
  buildCounterText,
  formatViewerCount,
  getViewerBotRatio,
  parseTwitchViewerCount,
} from '../../src/ui/chat/viewer-counter.js';
import { setLocale } from '../../src/i18n/i18n.js';

beforeEach(() => setLocale('ru'));

describe('parseTwitchViewerCount', () => {
  it('parses plain grouped numbers', () => {
    expect(parseTwitchViewerCount('1,250')).toBe(1250);
    expect(parseTwitchViewerCount('1 742')).toBe(1742);
    expect(parseTwitchViewerCount('12 400')).toBe(12400);
  });

  it('parses russian suffixes', () => {
    expect(parseTwitchViewerCount('1 742 зрителя')).toBe(1742);
    expect(parseTwitchViewerCount('1,8 тыс. зрителей')).toBe(1800);
    expect(parseTwitchViewerCount('1,2 млн')).toBe(1200000);
  });

  it('parses english suffixes', () => {
    expect(parseTwitchViewerCount('1.5k')).toBe(1500);
    expect(parseTwitchViewerCount('25K')).toBe(25000);
    expect(parseTwitchViewerCount('2.5M')).toBe(2500000);
  });

  it('returns null for unusable text', () => {
    expect(parseTwitchViewerCount('invalid')).toBe(null);
    expect(parseTwitchViewerCount('')).toBe(null);
    expect(parseTwitchViewerCount(null)).toBe(null);
  });
});

describe('formatViewerCount', () => {
  it('formats per locale', () => {
    expect(formatViewerCount(850, 'ru-RU')).toBe('850');
    expect(formatViewerCount(1653, 'ru-RU').replace(/\u00A0/g, ' ')).toBe('1 653');
  });
});

describe('getViewerBotRatio', () => {
  it('returns the suspicious share clamped to 1', () => {
    expect(getViewerBotRatio({ activeUsers: 100, suspiciousUsers: 20 })).toBe(0.2);
    expect(getViewerBotRatio({ activeUsers: 0, suspiciousUsers: 5 })).toBe(0);
    expect(getViewerBotRatio({ activeUsers: 10, suspiciousUsers: 50 })).toBe(1);
  });
});

describe('buildCounterParts', () => {
  it('splits the loading state into word and percent', () => {
    const parts = buildCounterParts({
      range: null,
      loading: { ready: false, percent: 66 },
    });
    expect(parts.loading).toBe(true);
    expect(parts.prefix).toBe(' (');
    expect(parts.word).toBe('Загружаю');
    expect(parts.suffix).toBe('…');
    expect(parts.percent).toBe('66%');
  });

  it('returns plain text once the range is ready', () => {
    const parts = buildCounterParts({
      range: { low: 1000, high: 1800 },
      loading: { ready: true, percent: 100 },
    });
    expect(parts.loading).toBe(false);
    expect(parts.text).toBe(' (≈1–1,8 тыс.)');
  });
});

describe('buildCounterText', () => {
  it('reads "Загружаю… 66%" in russian', () => {
    expect(
      buildCounterText({ range: null, loading: { ready: false, percent: 66 } })
    ).toBe(' (Загружаю… 66%)');
  });

  it('reads "Loading… 66%" in english', () => {
    setLocale('en');
    expect(
      buildCounterText({ range: null, loading: { ready: false, percent: 66 } })
    ).toBe(' (Loading… 66%)');
  });

  it('shows the range when ready', () => {
    expect(
      buildCounterText({
        range: { low: 8000, high: 12500 },
        loading: { ready: true, percent: 100 },
      })
    ).toBe(' (≈8–12,5 тыс.)');
  });

  it('falls back to a loading word without a range', () => {
    expect(buildCounterText({ range: null, loading: null })).toBe(' (Загружаю…)');
  });
});
