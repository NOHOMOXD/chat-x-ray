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
  it.each([[1,'чаттер'], [2,'чаттерса'], [5,'чаттерсов'], [21,'чаттер']])('shows %i chatters immediately', (observedChatters, word) => {
    expect(buildCounterParts({ observedChatters }).text).toBe(' · ' + observedChatters + ' ' + word);
  });

  it('returns plain text once the range is ready', () => {
    const parts = buildCounterParts({
      range: { low: 1000, high: 1800 },
      loading: { ready: true, percent: 100 },
    });
    expect(parts.text).toBe(' (≈1–1,8 тыс.)');
  });
});

describe('buildCounterParts formatting', () => {
  it('uses the english loading word', () => {
    setLocale('en');
    expect(buildCounterParts({ observedChatters: 80 }).text).toBe(' · 80 chatters');
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
    expect(parts.text).toBe('');
  });
});

describe('viewer popover observations', () => {
  it('shows the session clock and viewer metrics in one table', async () => {
    const { buildViewerTooltip } = await import('../../src/ui/shared/tooltip-controller.js');
    const tooltip = buildViewerTooltip({
      range: { low: 100, high: 500 }, official: 53_000,
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
  const model = (stats) => buildViewerModel({ official: 180_000, stats: { chatAccess: 'open', ...stats } });
  const starting = model({ sessionMs: 30_000, cleanUsers: 0, windowMessages: 0 });
  const progress = buildViewerTooltip(starting);
  expect(progress.textContent).toContain('Чаттерсов за время наблюдения0');
  expect(progress.textContent).not.toContain('%');
  const ready = { activeUsers: 1000, cleanUsers: 1000, windowMessages: 2000 };
  const preliminary = buildViewerTooltip(model({ ...ready, sessionMs: 120_000 }));
  expect(preliminary.querySelector('.tcx-tip__hero-value--range')).toBeTruthy();
  expect(preliminary.querySelector('.tcx-tip__hero-caption').textContent).toContain('Предварительно');
  const complete = buildViewerTooltip(model({ ...ready, sessionMs: 600_000 }));
  expect(complete.querySelector('.tcx-tip__hero-caption').textContent).toBe('Оценка по активности чата');
  expect(complete.textContent).toContain('Полное окно наблюдения — 10 минут');

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
  expect(tooltip.textContent).toContain('Отток 18,8%');
  expect(tooltip.textContent).toMatch(/−8\s383 \(−18,8%\)/);
  expect(tooltip.textContent).toMatch(/44\s493 → 36\s110/);
  expect(tooltip.textContent).toContain('За 5 мин не восстановился');
});

it('shows low engagement alongside comparable past broadcasts after the current counts', async () => {
  const { buildViewerModel } = await import('../../src/analysis/viewer-estimate.js');
  const { buildViewerTooltip } = await import('../../src/ui/shared/tooltip-controller.js');
  const input = { official: 10000, stats: { chatAccess: 'open', sessionMs: 600000,
    activeUsers: 80, cleanUsers: 80, windowMessages: 150 } };
  const render = (baseline) => {
    const model = buildViewerModel({ ...input, baseline });
    return buildViewerTooltip({ ...model, viewerStatus: 'lowEr' }).textContent;
  };
  const text = render({ er: 0.8, sessions: 5, low: 0.7, high: 1 });
  expect(text).toContain('Обычная для канала');
  expect(text).toContain('Низкая активность чата');
  expect(text.indexOf('80 из 80')).toBeLessThan(text.indexOf('Обычно на канале'));
  expect(render({ er: 1, lastEr: 1, sessions: 4 })).toContain('Прошлый эфир');
});

it('shows the ready follower-only estimate inline and keeps room details in the popover', async () => {
  const { buildViewerModel } = await import('../../src/analysis/viewer-estimate.js');
  const { buildViewerTooltip } = await import('../../src/ui/shared/tooltip-controller.js');
  const model = buildViewerModel({ official: 10000, stats: {
    chatAccess: 'followers', roomMode: { followers: 30, slow: 5 },
    sessionMs: 600000, activeUsers: 80, cleanUsers: 80, windowMessages: 300,
  } });
  expect(model.loading.ready).toBe(true);
  expect(model.range).toMatchObject({ low: 640, high: 1000 });
  expect(model.engagement).toMatchObject({ percent: 0.8, measurable: true, alert: false, belowOrganicBand: false });
  expect(buildCounterParts(model).text).toBe(buildCounterParts({ range: model.range, official: model.official }).text);
  expect(buildViewerTooltip(model).textContent).toContain('Только для фолловеров · Замедление');
});

it('orders the estimate, conclusion, current restrictions and assumptions in both locales', async () => {
  const { setLocale } = await import('../../src/i18n/i18n.js');
  const { buildViewerTooltip } = await import('../../src/ui/shared/tooltip-controller.js');
  try {
    for (const locale of ['en', 'ru']) {
      setLocale(locale);
      const model = { range: { low: 5800, high: 17500 }, official: 48223, sessionMs: 240000,
        chatAccess: 'followers', roomMode: { unique: 1 }, mixedMode: true, windowModes: [{}] };
      const root = buildViewerTooltip(model);
      expect([...root.children].slice(1, 5).map(node => node.className)).toEqual([
        'tcx-tip__hero', 'tcx-tip__status', 'tcx-tip__note', 'tcx-tip__note',
      ]);
      expect(root.querySelectorAll('strong.tcx-tip__status')).toHaveLength(1);
      expect(buildViewerTooltip({ ...model, chatAccess: 'unknown', roomMode: {} })
        .querySelectorAll('.tcx-tip__note')).toHaveLength(1);
    }
  } finally {
    setLocale('ru');
  }
});

it('shows the saved range for 60 seconds only on the same broadcast and profile', async () => {
  const { ViewerCounterAdjuster } = await import('../../src/ui/chat/viewer-counter.js');
  let identity = 'stream-1';
  const counter = new ViewerCounterAdjuster({ getBroadcast: () => identity });
  const target = document.createElement('span');
  document.body.appendChild(target);
  const fresh = { range: { low: 800, high: 1200 }, sampledAt: 10000, historyProfile: 'profile' };
  counter.renderMeasurement(target, fresh, 10000);
  const activity = { observedChatters: 1, historyProfile: 'profile' };
  counter.renderMeasurement(target, activity, 50000);
  expect(counter.el.textContent).toMatch(/Последняя оценка.*40 с назад/);
  expect(counter.el.getAttribute('aria-label')).toContain('40 с назад');
  counter.renderMeasurement(target, activity, 71000);
  expect(counter.el.textContent.trim()).toBe('· 1 чаттер');
  counter.renderMeasurement(target, { ...activity, historyProfile: 'changed' }, 51000);
  expect(counter.el.textContent).not.toContain('≈');
  identity = 'stream-2';
  counter.renderMeasurement(target, activity, 52000);
  expect(counter.el.textContent).not.toContain('≈');
  counter.remove();
  target.remove();
});

it('counts unique writing chatters before the range, including flagged accounts and excluding service bots', async () => {
  const { Analyzer } = await import('../../src/core/analyzer.js');
  const { buildViewerModel } = await import('../../src/analysis/viewer-estimate.js');
  const analyzer = new Analyzer();
  const start = Date.now();
  let sequence = 0;
  const send = (id, login) => {
    const ts = start + ++sequence;
    analyzer.ingest({ id: String(sequence), login, userId: String(id), text: 'hello chat', ts }, ts);
  };
  const model = () => buildViewerModel({ official: 5000, stats: analyzer.getStats(start + sequence, start) });
  send(1, 'nightbot');
  expect(buildCounterParts(model()).text).toBe('');
  for (let i = 0; i < 3; i++) send(2, 'writer');
  expect(model().observedChatters).toBe(1);
  for (let id = 3; id <= 81; id++) send(id, 'writer' + id);
  expect(buildCounterParts(model()).text).toBe(' · 80 чаттерсов');
  expect(model().range).toBeNull();
});
