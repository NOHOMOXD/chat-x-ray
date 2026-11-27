import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildCounterParts,
} from '../../src/ui/chat/viewer-counter-model.ts';
import { parseTwitchViewerCount } from '../../src/ui/chat/parse-viewer-count.ts';
import { setLocale } from '../../src/i18n/i18n.ts';

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
    expect(buildCounterParts({ observedChatters }).text).toBe(' (' + observedChatters + ')');
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
    expect(buildCounterParts({ observedChatters: 80 }).text).toBe(' (80)');
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

it('counts unique writing chatters before the range, including flagged accounts and excluding service bots', async () => {
  const { Analyzer } = await import('../../src/core/analyzer.ts');
  const { buildViewerModel } = await import('../../src/analysis/viewer-estimate.ts');
  const analyzer = new Analyzer();
  const start = Date.now();
  let sequence = 0;
  const send = (id: number, login: string) => {
    const ts = start + ++sequence;
    analyzer.ingest({ id: String(sequence), login, userId: String(id), text: 'hello chat', ts }, ts);
  };
  const model = () => {
    const result = buildViewerModel({ official: 5000, stats: analyzer.getStats(start + sequence, start) });
    if (!result) throw new Error('Expected a viewer model');
    return result;
  };
  send(1, 'nightbot');
  expect(buildCounterParts(model()).text).toBe('');
  for (let i = 0; i < 3; i++) send(2, 'writer');
  expect(model()?.observedChatters).toBe(1);
  for (let id = 3; id <= 81; id++) send(id, 'writer' + id);
  expect(buildCounterParts(model()).text).toBe(' (80)');
  expect(model()?.range).toBeNull();
});

it('keeps the StRoGo drop red until fifteen minutes after it closes', async () => {
  const { viewerStatus } = await import('../../src/ui/chat/viewer-counter-model.ts');
  const closedAt = 1795604482319;
  const lastOutflow = { from: 71549, to: 43270, status: 'observing' };
  const model = { churn: { lastOutflow }, engagement: { measurable: true }, range: {} };
  const duration = 900000;
  expect(viewerStatus(model, {}, closedAt - 1, duration)).toBe('outflow');
  Object.assign(lastOutflow, { status: 'unrecovered', closedAt });
  expect(viewerStatus(model, {}, closedAt + duration - 1, duration)).toBe('outflow');
  expect(viewerStatus(model, {}, closedAt + duration, duration)).toBe('ok');
});
