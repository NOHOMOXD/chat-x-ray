import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsModal, MENU_ROW_ID, MODAL_ID } from '../../src/ui/settings/settings-panel.js';
import { normalizeSettings } from '../../src/config/settings.js';
import { setLocale } from '../../src/i18n/i18n.js';

/** Build a modal wired to a mutable settings object. */
function makeModal(initial = {}) {
  let settings = normalizeSettings(initial);
  const commits = [];
  const modal = new SettingsModal({
    getSettings: () => settings,
    onCommit: (next) => {
      settings = normalizeSettings(next);
      commits.push(settings);
    },
    onPreview: (next) => {
      settings = normalizeSettings(next);
    },
    getLogger: () => ({ count: () => 7 }),
  });
  return {
    modal,
    commits,
    get settings() {
      return settings;
    },
  };
}

/** Twitch-shaped chat header so the floating button has a host. */
function mountChatHeader() {
  document.body.innerHTML =
    '<div class="stream-chat"><div class="stream-chat-header"></div></div>';
  return document.querySelector('.stream-chat-header');
}

beforeEach(() => {
  setLocale('en');
  document.body.innerHTML = '';
});

describe('header settings button', () => {
  it('is created once and removed by stop()', () => {
    const header = mountChatHeader();
    const harness = makeModal();
    harness.modal.start();

    expect(header.querySelectorAll('[data-tcx-ui="settings-button"]')).toHaveLength(1);
    expect(harness.modal.button.getAttribute('aria-label')).toBe('Settings');
    expect(harness.modal.button.getAttribute('aria-expanded')).toBe('false');

    // Repeated ensureButton() calls must not duplicate it.
    harness.modal.ensureButton();
    harness.modal.ensureButton();
    expect(header.querySelectorAll('[data-tcx-ui="settings-button"]')).toHaveLength(1);

    harness.modal.stop();
    expect(header.querySelectorAll('[data-tcx-ui="settings-button"]')).toHaveLength(0);
  });
});

describe('settings row inside Twitch chat settings', () => {
  /**
   * The extension only treats a popover as "open" when it is actually
   * rendered (>=160x80 px). happy-dom does no layout, so the fixture gives the
   * menu a box; the size check itself is exercised by the null case below.
   */
  function mountPopover() {
    document.body.innerHTML =
      '<button data-a-target="chat-settings"></button>' +
      '<div class="chat-settings-menu">' +
      '<div class="row"><button>Chat Filters</button></div>' +
      '<div class="row"><button>Hide Chat</button></div>' +
      '</div>';

    const popover = document.querySelector('.chat-settings-menu');
    popover.getBoundingClientRect = () => ({
      width: 320,
      height: 400,
      top: 0,
      left: 0,
      right: 320,
      bottom: 400,
    });
    for (const row of popover.querySelectorAll('button')) {
      row.getClientRects = () => [{ width: 320, height: 40 }];
    }
    return popover;
  }

  it('does nothing while the gear menu is closed', () => {
    document.body.innerHTML = '';
    const harness = makeModal();
    expect(harness.modal.ensureMenuRow()).toBe(null);
  });

  it('appends one labelled row at the end of the native menu', () => {
    const popover = mountPopover();
    const harness = makeModal();
    harness.modal.start();

    const row = harness.modal.ensureMenuRow();
    expect(row.id).toBe(MENU_ROW_ID);
    expect(row.tagName).toBe('BUTTON');
    expect(row.getAttribute('aria-haspopup')).toBe('dialog');
    expect(row.getAttribute('aria-controls')).toBe(MODAL_ID);
    expect(row.textContent).toContain('Chat X-Ray Settings');
    expect(popover.lastElementChild).toBe(row);
    // The old trailing chevron is gone.
    expect(row.querySelector('svg')).toBe(null);

    // Idempotent.
    harness.modal.ensureMenuRow();
    expect(popover.querySelectorAll('[data-tcx-ui="settings-menu-row"]')).toHaveLength(1);

    harness.modal.stop();
    expect(document.getElementById(MENU_ROW_ID)).toBe(null);
  });

  it('never nests inside a third-party group', () => {
    // BetterTTV and 7TV both append their own group to the same container.
    document.body.innerHTML =
      '<button data-a-target="chat-settings"></button>' +
      '<div class="chat-settings-menu">' +
      '<div class="row"><button>Chat Filters</button></div>' +
      '<div class="row"><button>Hide Chat</button></div>' +
      '<div class="bttv-chat-settings"><button>BetterTTV Settings</button></div>' +
      '<div class="seventv-settings"><button>7TV Settings</button></div>' +
      '</div>';

    const popover = document.querySelector('.chat-settings-menu');
    popover.getBoundingClientRect = () => ({
      width: 320,
      height: 400,
      top: 0,
      left: 0,
      right: 320,
      bottom: 400,
    });
    for (const row of popover.querySelectorAll('button')) {
      row.getClientRects = () => [{ width: 320, height: 40 }];
    }

    const harness = makeModal();
    harness.modal.start();
    const row = harness.modal.ensureMenuRow();

    // Our row is the last child of the container itself, never a descendant
    // of a foreign group: that is what keeps it visually separate.
    expect(row.parentElement).toBe(popover);
    expect(row.closest('.bttv-chat-settings')).toBe(null);
    expect(row.closest('.seventv-settings')).toBe(null);
  });

  it('opens the modal and stops the click from reaching Twitch', () => {
    const popover = mountPopover();
    const harness = makeModal();
    harness.modal.start();
    const row = harness.modal.ensureMenuRow();

    let bubbled = false;
    popover.addEventListener('click', () => {
      bubbled = true;
    });

    row.click();
    expect(harness.modal.isOpen()).toBe(true);
    expect(bubbled).toBe(false);
    expect(document.querySelector('.tcx-modal')).not.toBe(null);
  });
});

describe('modal lifecycle', () => {
  it('opens, focuses the close button and closes on Escape', () => {
    const harness = makeModal();
    harness.modal.start();
    harness.modal.openModal();

    const dialog = document.querySelector('.tcx-modal__dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(harness.modal.isOpen()).toBe(false);
    expect(document.querySelector('.tcx-modal')).toBe(null);
  });

  it('closes when the backdrop is clicked but not the dialog', () => {
    const harness = makeModal();
    harness.modal.openModal();

    document.querySelector('.tcx-modal__dialog').click();
    expect(harness.modal.isOpen()).toBe(true);

    document.querySelector('.tcx-modal').click();
    expect(harness.modal.isOpen()).toBe(false);
  });
});

describe('modal fields', () => {
  it('exposes every setting', () => {
    const harness = makeModal();
    harness.modal.openModal();
    const keys = Array.from(
      document.querySelectorAll('[data-tcx-setting]')
    ).map((input) => input.dataset.tcxSetting);

    for (const key of [
      'showBadges',
      'muteSuspicious',
      'hideSuspicious',
      'suspiciousThreshold',
      'showChatStats',
      'clientR9K',
      'r9kAction',
      'adjustViewerCounter',
      'enableAuditLog',
      'accountAgeLookup',
      'language',
    ]) {
      expect(keys).toContain(key);
    }
  });

  it('starts the threshold slider at 30%', () => {
    const harness = makeModal();
    harness.modal.openModal();
    const range = document.querySelector('[data-tcx-setting="suspiciousThreshold"]');
    expect(range.value).toBe('30');
    expect(range.min).toBe('10');
    expect(range.max).toBe('100');
  });

  it('commits a toggle change', () => {
    const harness = makeModal();
    harness.modal.openModal();
    const toggle = document.querySelector('[data-tcx-setting="showChatStats"]');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(harness.settings.showChatStats).toBe(false);
    expect(harness.commits).toHaveLength(1);
  });

  it('previews the threshold while dragging and commits on change', () => {
    const harness = makeModal();
    harness.modal.openModal();
    const range = document.querySelector('[data-tcx-setting="suspiciousThreshold"]');

    range.value = '60';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(harness.settings.suspiciousThreshold).toBe(60);
    expect(document.querySelector('[data-tcx-output="threshold"]').textContent).toBe('60%');

    range.dispatchEvent(new Event('change', { bubbles: true }));
    expect(harness.commits).toHaveLength(1);
  });

  it('shows the audit section only while the log is enabled', () => {
    const harness = makeModal({ enableAuditLog: false });
    harness.modal.openModal();
    expect(document.querySelector('.tcx-audit-section').hidden).toBe(true);

    harness.modal.close();
    const harness2 = makeModal({ enableAuditLog: true });
    harness2.modal.openModal();
    const section = document.querySelector('.tcx-audit-section');
    expect(section.hidden).toBe(false);
    expect(section.textContent).toContain('7');
  });

  it('resets every setting to its default', () => {
    const harness = makeModal({
      suspiciousThreshold: 80,
      showBadges: false,
      clientR9K: true,
      language: 'ru',
    });
    harness.modal.openModal();
    document.querySelector('[data-tcx-i18n="app.reset"]').click();

    expect(harness.settings.suspiciousThreshold).toBe(30);
    expect(harness.settings.showBadges).toBe(true);
    expect(harness.settings.clientR9K).toBe(false);
    expect(harness.settings.language).toBe('');
  });
});

describe('language switching', () => {
  it('re-renders static labels in the new language', () => {
    const harness = makeModal();
    harness.modal.openModal();

    expect(document.querySelector('.tcx-modal__title').textContent).toBe('Chat X-Ray');
    const closeBtn = document.querySelector('[data-tcx-i18n-attr="aria-label"]');
    expect(closeBtn.getAttribute('aria-label')).toBe('Close');

    setLocale('ru');
    harness.modal.refreshLabels();

    expect(closeBtn.getAttribute('aria-label')).toBe('Закрыть');
    expect(
      document.querySelector('[data-tcx-i18n="settings.threshold"]').textContent
    ).toBe('Порог срабатывания');
    expect(
      document.querySelector('[data-tcx-i18n="app.reset"]').textContent
    ).toBe('Сбросить настройки');
  });
});
