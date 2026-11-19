import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  botHue,
  formatNumber,
  formatViewerRange,
  formatViewerRangeCompact,
  isAlertState,
  isExtensionMutation,
  isExtensionNode,
  setAttributeIfChanged,
  setTextIfChanged,
} from '../../src/ui/shared/ui-utils.js';
import { setLocale } from '../../src/i18n/i18n.js';

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

describe('extension node detection', () => {
  it('recognises our own UI and ignores ordinary nodes', () => {
    const ours = document.createElement('div');
    ours.setAttribute('data-tcx-ui', 'stats');
    const other = document.createElement('div');
    document.body.append(ours, other);

    expect(isExtensionNode(ours)).toBe(true);
    expect(isExtensionNode(other)).toBe(false);
    expect(isExtensionNode(null)).toBe(false);
  });

  it('ignores mutations that only touched our UI', () => {
    const ours = document.createElement('div');
    ours.setAttribute('data-tcx-ui', 'stats');
    document.body.appendChild(ours);

    const mutation = { target: ours, addedNodes: [], removedNodes: [] };
    expect(isExtensionMutation(mutation)).toBe(true);
    expect(isExtensionMutation(null)).toBe(false);

    const pageNode = document.createElement('div');
    document.body.appendChild(pageNode);
    expect(
      isExtensionMutation({ target: pageNode, addedNodes: [], removedNodes: [] })
    ).toBe(false);
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
