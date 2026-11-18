import { beforeEach, describe, expect, it } from 'vitest';

import { StatsView } from '../../src/ui/chat/stats-view.js';
import { normalizeSettings } from '../../src/config/settings.js';
import { setLocale } from '../../src/i18n/i18n.js';

function mountChat() {
  document.body.innerHTML =
    '<div class="stream-chat">' +
    '<div class="stream-chat-header"></div>' +
    '<div class="chat-scrollable-area__message-container"></div>' +
    '</div>';
  return document.querySelector('.chat-scrollable-area__message-container');
}

function baseStats(overrides = {}) {
  return {
    messagesPerMinute: 120,
    activeUsers: 30,
    cleanUsers: 25,
    suspiciousUsers: 5,
    suspiciousPercent: 12,
    suspiciousShare: 5 / 30,
    windowMessages: 400,
    sessionMs: 10 * 60 * 1000,
    isBotWave: false,
    ...overrides,
  };
}

function makeView(stats, settings = {}) {
  const current = normalizeSettings(settings);
  return {
    view: new StatsView({
      getStats: () => stats,
      getSettings: () => current,
    }),
    settings: current,
  };
}

beforeEach(() => {
  setLocale('en');
  document.body.innerHTML = '';
});

describe('mounting', () => {
  it('mounts the strip above the chat container', () => {
    const container = mountChat();
    const { view } = makeView(baseStats());
    view.ensure(container);

    const strip = document.querySelector('[data-tcx-ui="stats"]');
    expect(strip).not.toBe(null);
    expect(strip.getAttribute('lang')).toBe('en');
    expect(strip.querySelectorAll('.tcx-stats__metric')).toHaveLength(3);
  });

  it('never duplicates itself', () => {
    const container = mountChat();
    const { view } = makeView(baseStats());
    view.ensure(container);
    view.ensure(container);
    expect(document.querySelectorAll('[data-tcx-ui="stats"]')).toHaveLength(1);
  });

  it('has no one-hit metric any more', () => {
    const container = mountChat();
    const { view } = makeView(baseStats());
    view.ensure(container);
    const strip = document.querySelector('[data-tcx-ui="stats"]');
    expect(strip.querySelector('.tcx-stats__metric--onehit')).toBe(null);
    expect(strip.textContent.toLowerCase()).not.toContain('one-hit');
  });
});

describe('visibility setting', () => {
  it('removes the strip when showChatStats is off', () => {
    const container = mountChat();
    const { view } = makeView(baseStats(), { showChatStats: false });
    view.ensure(container);
    expect(document.querySelector('[data-tcx-ui="stats"]')).toBe(null);
  });

  it('removes an already mounted strip when the setting is turned off', () => {
    const container = mountChat();
    const stats = baseStats();
    const current = normalizeSettings({ showChatStats: true });
    const view = new StatsView({
      getStats: () => stats,
      getSettings: () => current,
    });
    view.ensure(container);
    expect(document.querySelector('[data-tcx-ui="stats"]')).not.toBe(null);

    current.showChatStats = false;
    view.update();
    expect(document.querySelector('[data-tcx-ui="stats"]')).toBe(null);
  });
});

describe('values', () => {
  it('renders tempo, active users and suspicious share', () => {
    const container = mountChat();
    const { view } = makeView(baseStats());
    view.ensure(container);
    const text = document.querySelector('[data-tcx-ui="stats"]').textContent;
    expect(text).toContain('120');
    expect(text).toContain('30');
    expect(text).toContain('12%');
  });
});

describe('loading badge', () => {
  it('shows the percentage while the sample is short', () => {
    const container = mountChat();
    const { view } = makeView(
      baseStats({ sessionMs: 30000, cleanUsers: 2, windowMessages: 3 })
    );
    view.ensure(container);

    const badge = document.querySelector('.tcx-stats__loading');
    expect(badge.hidden).toBe(false);
    // Word first, percentage last: the dots hang off the word.
    expect(badge.children[0].className).toBe('tcx-stats__loading-word');
    expect(badge.children[1].tagName).toBe('B');
    expect(badge.children[1].textContent).toMatch(/^\d{1,3}%$/);
  });

  it('hides the badge once the estimate is ready', () => {
    const container = mountChat();
    const { view } = makeView(baseStats());
    view.ensure(container);
    expect(document.querySelector('.tcx-stats__loading').hidden).toBe(true);
  });
});

describe('alert states', () => {
  it('turns red on a bot wave', () => {
    const container = mountChat();
    const { view } = makeView(baseStats({ isBotWave: true }));
    view.ensure(container);
    const strip = document.querySelector('[data-tcx-ui="stats"]');
    expect(strip.dataset.wave).toBe('1');
    expect(strip.classList.contains('tcx-stats--alert')).toBe(true);
  });

  it('turns red when the suspicious share reaches the threshold', () => {
    const container = mountChat();
    const { view } = makeView(baseStats(), { suspiciousThreshold: 25 });
    view.stats = baseStats({ suspiciousShare: 0.3, suspiciousPercent: 30 });
    const stats = { suspiciousShare: 0.3, suspiciousPercent: 30 };
    const view2 = new StatsView({
      getStats: () => baseStats(stats),
      getSettings: () => normalizeSettings({ suspiciousThreshold: 25 }),
    });
    view2.ensure(container);
    expect(
      document.querySelector('[data-tcx-ui="stats"]').classList.contains('tcx-stats--alert')
    ).toBe(true);
  });

  it('stays neutral for a healthy chat', () => {
    const container = mountChat();
    const { view } = makeView(baseStats(), { suspiciousThreshold: 25 });
    view.ensure(container);
    expect(
      document.querySelector('[data-tcx-ui="stats"]').classList.contains('tcx-stats--alert')
    ).toBe(false);
  });
});

describe('language', () => {
  it('re-renders labels after a language switch', () => {
    const container = mountChat();
    const { view } = makeView(baseStats());
    view.ensure(container);
    expect(document.querySelector('[data-tcx-ui="stats"]').textContent).toContain(
      'active in chat'
    );

    setLocale('ru');
    view.refreshLabels();
    const strip = document.querySelector('[data-tcx-ui="stats"]');
    expect(strip.textContent).toContain('активных в чате');
    expect(strip.getAttribute('lang')).toBe('ru');
  });
});
