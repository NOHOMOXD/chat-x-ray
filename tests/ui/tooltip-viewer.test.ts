import { describe, expect, it } from 'vitest';
import { buildViewerTooltip } from '../../src/ui/shared/tooltip-viewer.ts';
import { t } from '../../src/i18n/i18n.ts';

describe('viewer tooltip', () => {
  it('renders a saved range and a viewer movement', () => {
    const tooltip = buildViewerTooltip({
      range: { low: 100, high: 200 }, official: 500, sessionMs: 600000,
      chatAccess: 'open', recentAge: 30,
      churn: { lastOutflow: { kind: 'viewer-outflow', from: 500, to: 200, delta: -300, status: 'recovered' } },
    });
    expect(tooltip.querySelector('.tcx-tip__hero-value')?.textContent).toContain('100');
    expect(tooltip.querySelector('.tcx-tip__event')?.textContent).toContain('300');
    expect(tooltip.textContent).toContain(t('tip.viewer.window'));
  });

  it('ignores malformed external events and displays the loading state', () => {
    const tooltip = buildViewerTooltip({
      range: { low: 'invalid', high: 200 }, loading: { percent: 25 },
      churn: { lastOutflow: { kind: 'viewer-outflow', from: 500, delta: 'bad' } },
    });
    expect(tooltip.querySelector('.tcx-tip__hero-value')).toBeNull();
    expect(tooltip.querySelector('.tcx-progress-value')?.textContent).toBe('25%');
    expect(tooltip.querySelector('.tcx-tip__event')).toBeNull();
  });
});
