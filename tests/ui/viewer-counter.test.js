import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCounterParts,
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

describe('buildCounterParts formatting', () => {
  it('uses the english loading word', () => {
    setLocale('en');
    const parts = buildCounterParts({
      range: null,
      loading: { ready: false, percent: 66 },
    });
    expect(parts.word).toBe('Loading');
    expect(parts.percent).toBe('66%');
  });

  it('shows the compact range when ready', () => {
    const parts = buildCounterParts({
      range: { low: 8000, high: 12500 },
      loading: { ready: true, percent: 100 },
    });
    expect(parts.text).toBe(' (≈8–12,5 тыс.)');
  });

  it('falls back to a loading word without a range', () => {
    const parts = buildCounterParts({ range: null, loading: null });
    expect(parts.text).toBe(' (Загружаю…)');
  });
});

describe('viewer popover observations', () => {
  it('shows the session clock and viewer metrics in one table', async () => {
    const { buildViewerTooltip } = await import('../../src/ui/shared/tooltip-controller.js');
    const tooltip = buildViewerTooltip({
      official: 53_000,
      stableOfficial: 50_000,
      sessionMs: 60_000,
      minute: { authors: 240, messages: 326, from: 48_000, to: 53_000 },
      churn: {
        totalChurnEvents: 2, averageDrop: 4000, totalSurges: 1, averageSurge: 5000,
        totalOutflows: 0,
        lastAnomaly: { kind: 'surge', from: 48_000, to: 53_000, delta: 5000 },
      },
    });
    expect(tooltip.querySelector('.tcx-tip__list').textContent).toContain('Онлайн за минуту');
    expect(tooltip.textContent).toContain('собрано 1 из 10 мин');
    expect(tooltip.textContent).toContain('Крупные изменения счётчика Twitch');
    expect(tooltip.textContent).toContain('Последний наплыв');
    expect(tooltip.textContent).toContain('Оттоки за сессию0');
    expect(tooltip.querySelectorAll('.tcx-tip__note--drops')).toHaveLength(0);
  });
});

it('shows the shared progress, then a provisional and a full viewer range', async () => {
  const { buildViewerModel } = await import('../../src/analysis/viewer-estimate.js');
  const { buildViewerTooltip } = await import('../../src/ui/shared/tooltip-controller.js');
  const model = (stats) => buildViewerModel({ official: 180_000, stats });
  const starting = model({ sessionMs: 30_000, cleanUsers: 0, windowMessages: 0 });
  const progress = buildViewerTooltip(starting);
  expect(progress.querySelector('.tcx-tip__hero-value').textContent)
    .toBe(`Собираем данные · ${starting.loading.percent}%`);
  expect(progress.textContent).toContain('Нужно 2 мин наблюдения');
  expect(progress.textContent).toContain('Чистых авторов 0 из 2');
  expect(progress.textContent).toContain('Сообщений аудитории 0 из 5');

  const ready = { activeUsers: 1000, cleanUsers: 1000, windowMessages: 2000 };
  const preliminary = buildViewerTooltip(model({ ...ready, sessionMs: 120_000 }));
  expect(preliminary.querySelector('.tcx-tip__hero-value--range')).toBeTruthy();
  expect(preliminary.querySelector('.tcx-tip__hero-caption').textContent).toContain('Предварительно');
  const complete = buildViewerTooltip(model({ ...ready, sessionMs: 600_000 }));
  expect(complete.querySelector('.tcx-tip__hero-caption').textContent).toBe('Оценка по чату');
  expect(complete.textContent).toContain('чат за последние 10 мин');

  const disconnected = buildViewerTooltip({ ...starting, viewerStatus: 'disconnected' });
  expect(disconnected.querySelector('.tcx-tip__hero')).toBeNull();
  expect(disconnected.textContent).toContain('Соединение с чатом прервано');
});

it('shows a lasting viewer drop and its unrecovered status in the popover', async () => {
  const { buildViewerTooltip } = await import('../../src/ui/shared/tooltip-controller.js');
  const tooltip = buildViewerTooltip({
    official: 36327,
    churn: {
      totalSurges: 0, totalOutflows: 1, totalChurnEvents: 0,
      lastOutflow: {
        kind: 'viewer-outflow', from: 44493, to: 36110, delta: -8383,
        ts: 1795082818943, status: 'unrecovered',
      },
    },
  });
  expect(tooltip.textContent).toContain('Оттоки за сессию1');
  expect(tooltip.textContent).toMatch(/−8\s383 \(−18,8%\)/);
  expect(tooltip.textContent).toMatch(/44\s493 → 36\s110/);
  expect(tooltip.textContent).toContain('За 5 мин не восстановился');
});
