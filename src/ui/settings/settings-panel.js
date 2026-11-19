/*
 * Twitch Chat X-Ray — settings entry points and floating settings window.
 *
 * How a user reaches the settings (same pattern as BetterTTV): the native
 * Chat Settings popover gets a labelled "Chat X-Ray Settings" row, exactly like
 * BTTV adds "BetterTV Settings". Opening the gear therefore never stretches or
 * restyles the native menu — the row is one line, and the real options open in
 * our own modal dialog window.
 *
 * A small gear button is also pinned into the chat header as a shortcut and as
 * a fallback for popout/embedded chat where Twitch renders no settings popover.
 * Both entry points open the same modal, which is built with DOM nodes only,
 * owns its open/close lifecycle (Escape, backdrop click, close button) and
 * every label goes through t() so it follows the UI language.
 */
import { setTextIfChanged } from '../shared/ui-utils.js';
import { t } from '../../i18n/i18n.js';

const CHAT_HEADER_SELECTORS = [
  '.stream-chat-header',
  '.chat-room__header',
  '[data-test-selector="chat-room-header"]',
];
const GEAR_SELECTOR = '[data-a-target="chat-settings"]';
const SETTINGS_PANEL_SELECTORS = [
  '[data-a-target="chat-settings-menu"]',
  '[data-test-selector="chat-settings-popover"]',
  '[data-test-selector="chat-settings-menu"]',
  '.chat-settings-menu',
  '.chat-settings__content',
  '[role="dialog"][aria-labelledby]',
];
const SETTINGS_ROW_SELECTOR = 'button, [role="menuitem"], [role="button"], a';
const BUTTON_ID = 'tcx-settings-button';
const MODAL_ID = 'tcx-settings-modal';
const MENU_ROW_ID = 'tcx-settings-menu-row';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export class SettingsModal {
  constructor(options) {
    this.getSettings = options.getSettings;
    this.onCommit = options.onCommit;
    this.onPreview = options.onPreview || (() => {});
    this.getLogger = options.getLogger || (() => null);
    this.downloadSession = options.downloadSession || (() => {});
    this.sessionAvailability = [false, false];

    this.button = null;
    this.buttonHost = null;
    this.modal = null;
    this.menuRow = null;
    this.menuRowHost = null;
    this.refs = null;
    this.open = false;

    this._onInput = this._onInput.bind(this);
    this._onChange = this._onChange.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onDocumentClick = this._onDocumentClick.bind(this);
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    // Capture phase: our row/button handlers must run before Twitch's own
    // menu handlers can close the popover or reinterpret the click.
    document.addEventListener('click', this._onDocumentClick, true);
    this.ensureButton();
  }

  stop() {
    document.removeEventListener('click', this._onDocumentClick, true);
    this.close();
    if (this.button) {
      this.button.remove();
    }
    if (this.menuRow) {
      this.menuRow.remove();
    }
    this.button = null;
    this.buttonHost = null;
    this.menuRow = null;
    this.menuRowHost = null;
  }

  /**
   * Keep a labelled "Chat X-Ray Settings" row at the end of Twitch's own Chat
   * Settings menu. Appending last is deliberate: BetterTTV and 7TV build their
   * own groups inside the same container, so any fixed insertion point would
   * either land inside or interleave with a foreign group. The end of the
   * container is the one position whose ownership we can state outright.
   * Twitch renders the popover only while it is open, so this is re-checked on
   * every page mutation and in the 1 s maintenance loop.
   */
  ensureMenuRow() {
    const host = this._findSettingsMenuHost();
    if (this.menuRow && this.menuRow.isConnected && host === this.menuRowHost) {
      // A later-mounted extension (7TV appends its group after us) must not
      // leave our row stranded above it: re-assert the last position.
      if (host.lastElementChild !== this.menuRow) {
        host.appendChild(this.menuRow);
      }
      return this.menuRow;
    }
    if (this.menuRow) {
      this.menuRow.remove();
    }
    this.menuRow = null;
    this.menuRowHost = host;
    if (!host) {
      return null;
    }

    const row = this._createMenuRow();
    if (this._hasNativeToggles(host)) {
      // Older popover layouts render every option as a toggle row; keep the
      // same skeleton so ours does not look out of place.
      row.classList.add('tcx-settings-row--native');
    }
    host.appendChild(row);
    this.menuRow = row;
    return row;
  }

  /** Keep the floating button pinned into the live chat header. */
  ensureButton() {
    const host = this._findHeaderHost();
    if (this.button && this.button.isConnected && host === this.buttonHost) {
      return;
    }
    if (this.button) {
      this.button.remove();
    }
    this.button = null;
    this.buttonHost = host;
    if (!host) {
      return;
    }
    const button = this._createButton();
    host.appendChild(button);
    this.button = button;
  }

  isOpen() {
    return this.open;
  }

  openModal() {
    if (this.open) {
      return;
    }
    this.open = true;
    const modal = this._createModal();
    this.modal = modal;
    root().appendChild(modal);
    document.addEventListener('keydown', this._onKeyDown, true);
    document.addEventListener('pointerdown', this._onPointerDown, true);
    this.sync();
    this._updateScrollShadow();
    if (this.button) {
      this.button.setAttribute('aria-expanded', 'true');
    }
    const close = modal.querySelector('[data-tcx-close]');
    if (close && typeof close.focus === 'function') {
      close.focus();
    }
  }

  close() {
    if (!this.open) {
      return;
    }
    this.open = false;
    document.removeEventListener('keydown', this._onKeyDown, true);
    document.removeEventListener('pointerdown', this._onPointerDown, true);
    if (this.modal) {
      this.modal.remove();
    }
    this.modal = null;
    this.refs = null;
    if (this.button) {
      this.button.setAttribute('aria-expanded', 'false');
      if (typeof this.button.focus === 'function') {
        this.button.focus();
      }
    }
  }

  toggle() {
    if (this.open) {
      this.close();
    } else {
      this.openModal();
    }
  }

  // -------------------------------------------------------------- translation

  /** Re-render every static label (language switched while the modal is open). */
  refreshLabels() {
    if (this.button) {
      this.button.setAttribute('aria-label', t('app.settings'));
      this.button.setAttribute('title', t('app.settings'));
    }
    const menuRow = this.menuRow;
    if (menuRow && menuRow.isConnected) {
      const label = menuRow.querySelector('[data-tcx-i18n="app.settingsEntry"]');
      if (label) {
        setTextIfChanged(label, t('app.settingsEntry'));
      }
      menuRow.setAttribute('aria-label', t('app.settingsEntry'));
    }
    if (!this.modal) {
      return;
    }
    const modal = this.modal;
    modal.setAttribute('aria-label', t('settings.title'));
    const nodes = modal.querySelectorAll('[data-tcx-i18n]');
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const key = node.dataset.tcxI18n;
      const attr = node.dataset.tcxI18nAttr;
      if (attr) {
        node.setAttribute(attr, t(key));
      } else {
        setTextIfChanged(node, t(key));
      }
    }
    this.sync();
  }

  // ------------------------------------------------------------------ syncing

  sync() {
    if (!this.modal || !this.refs) {
      return;
    }
    const settings = this.getSettings();
    const inputs = this.modal.querySelectorAll('[data-tcx-setting]');
    for (let i = 0; i < inputs.length; i += 1) {
      const input = inputs[i];
      const key = input.dataset.tcxSetting;
      if (key === 'suspiciousThreshold') {
        const value = String(settings.suspiciousThreshold);
        if (input.value !== value) {
          input.value = value;
        }
        this._paintRange(input, settings.suspiciousThreshold);
      } else if (key === 'r9kAction' || key === 'language') {
        if (input.value !== settings[key]) {
          input.value = settings[key];
        }
        if (key === 'r9kAction') {
          const disabled = !settings.clientR9K;
          if (input.disabled !== disabled) {
            input.disabled = disabled;
          }
        }
      } else {
        const checked = Boolean(settings[key]);
        if (input.checked !== checked) {
          input.checked = checked;
        }
      }
    }

    const output = this.modal.querySelector('[data-tcx-output="threshold"]');
    if (output) {
      setTextIfChanged(output, settings.suspiciousThreshold + '%');
    }

    const auditSection = this.modal.querySelector('.tcx-audit-section');
    if (auditSection) {
      const shouldHide = !settings.enableAuditLog;
      if (auditSection.hidden !== shouldHide) {
        auditSection.hidden = shouldHide;
      }
      this.syncAuditCount();
    }
  }

  syncSessionButtons(current, previous) {
    this.sessionAvailability = [current, previous];
    this.modal?.querySelectorAll('[data-tcx-session-export]').forEach((button) => {
      button.disabled = !this.sessionAvailability[Number(button.dataset.tcxSessionExport)];
    });
  }

  syncAuditCount() {
    const logger = this.getLogger();
    if (!this.modal || !logger) {
      return;
    }
    const countEl = this.modal.querySelector('[data-tcx-audit-count]');
    if (countEl) {
      setTextIfChanged(countEl, logger.count());
    }
  }

  /** Confirmation flash for the audit buttons ("✔ Скопировано!"). */
  _flash(button, key) {
    const original = t(key);
    setTextIfChanged(button, t('settings.copied'));
    window.setTimeout(() => {
      if (button.isConnected) {
        setTextIfChanged(button, original);
      }
    }, 1500);
  }

  // ----------------------------------------------------------------- creation

  _findHeaderHost() {
    for (let i = 0; i < CHAT_HEADER_SELECTORS.length; i += 1) {
      const node = document.querySelector(CHAT_HEADER_SELECTORS[i]);
      if (node && node.isConnected) {
        return node;
      }
    }
    return null;
  }

  /**
   * Locate the open native Chat Settings popover and return the element whose
   * end is the bottom of the option list (so our row lands after the last
   * native row, like BetterTTV's).
   */
  _findSettingsMenuHost() {
    const gear = document.querySelector(GEAR_SELECTOR);
    // The popover only exists while the gear menu is open.
    if (!gear) {
      return null;
    }

    for (let i = 0; i < SETTINGS_PANEL_SELECTORS.length; i += 1) {
      const nodes = document.querySelectorAll(SETTINGS_PANEL_SELECTORS[i]);
      for (let j = 0; j < nodes.length; j += 1) {
        const panel = nodes[j];
        if (!panel || !panel.isConnected || panel.closest('[data-tcx-ui="settings-modal"]')) {
          continue;
        }
        const rect = panel.getBoundingClientRect ? panel.getBoundingClientRect() : null;
        if (!rect || rect.width < 160 || rect.height < 80) {
          continue;
        }
        return this._resolveRowContainer(panel);
      }
    }
    return null;
  }

  /** Where inside the popover to append: after the last option, not in a header. */
  _resolveRowContainer(panel) {
    if (!panel || !panel.querySelectorAll) {
      return null;
    }

    // Best case: the popover has a dedicated options container.
    const content = panel.querySelector('.chat-settings__content');
    if (content && content.isConnected) {
      return content;
    }

    // Otherwise walk up from the last native option to the list that holds
    // several options; the header/title bar has only one or two buttons.
    const rows = panel.querySelectorAll(SETTINGS_ROW_SELECTOR);
    let last = null;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (row && row.isConnected && row.getClientRects && row.getClientRects().length) {
        if (!row.closest('[data-tcx-ui]')) {
          last = row;
          break;
        }
      }
    }
    if (!last) {
      return panel;
    }

    // The last option is usually wrapped in its own row element; appending
    // there would put our row *inside* a native option. Walk up from the
    // wrapper and take the first element that looks like a list: it must
    // contain more than one option and not be that single wrapper itself.
    let fallback = panel;
    let node = last.parentElement;
    while (node && node !== panel) {
      const optionCount = node.querySelectorAll(SETTINGS_ROW_SELECTOR).length;
      const isWrapperOfOne = node === last.parentElement && optionCount < 2;
      if (optionCount >= 2 && !isWrapperOfOne) {
        return node;
      }
      fallback = node;
      node = node.parentElement;
    }
    // Flat popover: options sit directly in the panel.
    return panel;
  }

  /** True when the native menu renders toggle rows, so our row can match. */
  _hasNativeToggles(host) {
    return Boolean(
      host &&
        host.querySelector &&
        host.querySelector(
          'input[type="checkbox"], [role="switch"], [role="checkbox"]'
        )
    );
  }

  _createMenuRow() {
    const row = document.createElement('button');
    row.type = 'button';
    row.id = MENU_ROW_ID;
    row.className = 'tcx-settings-row';
    row.dataset.tcxUi = 'settings-menu-row';
    row.setAttribute('data-test-selector', 'tcx-settings-menu-row');
    row.setAttribute('aria-haspopup', 'dialog');
    row.setAttribute('aria-controls', MODAL_ID);

    const label = el('span', 'tcx-settings-row__label');
    label.dataset.tcxI18n = 'app.settingsEntry';
    label.textContent = t('app.settingsEntry');

    row.appendChild(label);

    row.addEventListener('click', (event) => {
      // Stop Twitch's menu from closing and swallowing the click.
      event.preventDefault();
      event.stopPropagation();
      this.openModal();
    });

    return row;
  }

  _createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = 'tcx-settings-button';
    button.dataset.tcxUi = 'settings-button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', MODAL_ID);
    button.setAttribute('aria-label', t('app.settings'));
    button.setAttribute('title', t('app.settings'));

    // Inline SVG built node by node — no innerHTML anywhere in the extension.
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '20');
    icon.setAttribute('height', '20');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.appendChild(svgPath(GEAR_PATH));
    icon.appendChild(svgPath(GEAR_HUB));
    button.appendChild(icon);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
    });
    return button;
  }

  _createModal() {
    const overlay = el('div', 'tcx-modal');
    overlay.id = MODAL_ID;
    overlay.dataset.tcxUi = 'settings-modal';
    overlay.setAttribute('role', 'presentation');

    const dialog = el('div', 'tcx-modal__dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'tcx-modal-title');

    // ---- header
    const header = el('div', 'tcx-modal__header');
    const heading = el('div', 'tcx-modal__heading');
    const icon = el('span', 'tcx-modal__icon');
    const h2 = el('h2', 'tcx-modal__title', t('app.name'));
    h2.id = 'tcx-modal-title';
    heading.appendChild(icon);
    heading.appendChild(h2);

    const closeBtn = el('button', 'tcx-modal__close', '✕');
    closeBtn.type = 'button';
    closeBtn.dataset.tcxClose = '1';
    closeBtn.dataset.tcxI18n = 'app.close';
    closeBtn.dataset.tcxI18nAttr = 'aria-label';
    closeBtn.setAttribute('aria-label', t('app.close'));
    closeBtn.addEventListener('click', () => this.close());

    header.appendChild(heading);
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    // Everything below is scoped to .tcx-xray-panel so Twitch's own
    // .chat-settings rules can never bleed into our controls.
    const body = el('div', 'tcx-modal__body tcx-xray-panel');
    this.refs = {};

    // ---- badges & filtering
    body.appendChild(this._sectionLabel('settings.section.filters'));
    body.appendChild(this._toggleRow('settings.showBadges', 'showBadges'));
    body.appendChild(this._toggleRow('settings.mute', 'muteSuspicious'));
    body.appendChild(this._toggleRow('settings.hide', 'hideSuspicious'));
    body.appendChild(this._thresholdRow());

    // ---- chat
    body.appendChild(this._sectionLabel('settings.section.chat'));
    body.appendChild(
      this._toggleRow('settings.showChatStats', 'showChatStats')
    );
    body.appendChild(this._help('settings.showChatStatsHelp'));

    // ---- R9K
    body.appendChild(this._sectionLabel('settings.section.r9k'));
    body.appendChild(this._toggleRow('settings.r9k', 'clientR9K'));
    body.appendChild(this._selectRow(
      'settings.r9kAction',
      'r9kAction',
      'settings.r9kActionAria',
      [
        { value: 'mute', key: 'settings.r9kMute' },
        { value: 'hide', key: 'settings.r9kHide' },
      ]
    ));

    // ---- data
    body.appendChild(this._sectionLabel('settings.section.data'));
    body.appendChild(
      this._toggleRow('settings.adjustViewer', 'adjustViewerCounter')
    );
    body.appendChild(this._toggleRow('settings.audit', 'enableAuditLog'));
    body.appendChild(
      this._toggleRow('settings.accountAge', 'accountAgeLookup')
    );
    body.appendChild(this._auditSection());
    body.appendChild(this._toggleRow('settings.recordSession', 'recordSession'));
    const exports = el('div', 'tcx-audit-btn-group');
    ['settings.sessionDownload', 'settings.previousSessionDownload'].forEach((key, index) => {
      const button = el('button', 'tcx-audit-btn', t(key));
      button.type = 'button';
      button.dataset.tcxI18n = key;
      button.dataset.tcxSessionExport = String(index);
      button.disabled = !this.sessionAvailability[index];
      button.addEventListener('click', () => this.downloadSession(index === 1));
      exports.appendChild(button);
    });
    body.appendChild(exports);

    // ---- interface
    body.appendChild(this._sectionLabel('settings.section.interface'));
    body.appendChild(this._selectRow(
      'settings.language',
      'language',
      'settings.language',
      [
        { value: '', key: 'settings.languageAuto' },
        { value: 'ru', key: 'settings.languageRu' },
        { value: 'en', key: 'settings.languageEn' },
      ]
    ));

    // Fade the bottom edge when more rows are below the fold, so a truncated
    // list on a short viewport reads as "scroll me" instead of "cut off".
    body.addEventListener('scroll', () => this._updateScrollShadow(), {
      passive: true,
    });

    const scroller = el('div', 'tcx-modal__scroller');
    scroller.dataset.more = t('settings.scrollMore');
    scroller.appendChild(body);
    dialog.appendChild(scroller);

    // ---- footer
    const footer = el('div', 'tcx-modal__footer');
    const hint = el('p', 'tcx-modal__hint', t('settings.hint'));
    hint.dataset.tcxI18n = 'settings.hint';
    const resetBtn = el('button', 'tcx-modal__reset', t('app.reset'));
    resetBtn.type = 'button';
    resetBtn.dataset.tcxI18n = 'app.reset';
    resetBtn.addEventListener('click', () => this._reset());
    footer.appendChild(hint);
    footer.appendChild(resetBtn);
    dialog.appendChild(footer);

    // Bound once in the constructor; the dialog is re-created with every
    // open() and dropped together with its listeners in close().
    dialog.addEventListener('input', this._onInput);
    dialog.addEventListener('change', this._onChange);
    overlay.appendChild(dialog);

    // Clicking the backdrop (not the dialog) closes the window.
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        this.close();
      }
    });

    return overlay;
  }

  _reset() {
    const reset = Object.assign({}, this.getSettings());
    const defaults = {
      showBadges: true,
      muteSuspicious: false,
      hideSuspicious: false,
      suspiciousThreshold: 30,
      clientR9K: false,
      r9kAction: 'mute',
      enableAuditLog: false,
      recordSession: false,
      adjustViewerCounter: true,
      accountAgeLookup: false,
      showChatStats: true,
      language: '',
    };
    Object.keys(defaults).forEach((key) => {
      reset[key] = defaults[key];
    });
    this.onCommit(reset);
    this.sync();
  }

  _sectionLabel(key) {
    const label = el('div', 'tcx-xray-panel__section', t(key));
    label.dataset.tcxI18n = key;
    return label;
  }

  _updateScrollShadow() {
    if (!this.modal) {
      return;
    }
    const body = this.modal.querySelector('.tcx-modal__body');
    if (!body) {
      return;
    }
    const scroller = this.modal.querySelector('.tcx-modal__scroller');
    if (scroller) {
      scroller.dataset.more = t('settings.scrollMore');
    }
    const more =
      body.scrollHeight - body.scrollTop - body.clientHeight > 8;
    this.modal.classList.toggle('tcx-modal--scrollable', more);
  }

  /** Keep the purple fill of the threshold slider in sync with its value. */
  _paintRange(range, value) {
    if (!range || !range.style || typeof range.style.setProperty !== 'function') {
      return;
    }
    const min = Number(range.min) || 10;
    const max = Number(range.max) || 100;
    const current = Number(value);
    if (!Number.isFinite(current)) {
      return;
    }
    const percent = ((current - min) / (max - min)) * 100;
    range.style.setProperty(
      '--tcx-range-pct',
      Math.min(100, Math.max(0, percent)).toFixed(1) + '%'
    );
  }

  _help(key) {
    const help = el('p', 'tcx-xray-panel__help', t(key));
    help.dataset.tcxI18n = key;
    return help;
  }

  _toggleRow(key, settingKey) {
    const label = el('label', 'tcx-xray-panel__row');
    const text = el('span', 'tcx-xray-panel__label', t(key));
    text.dataset.tcxI18n = key;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'tcx-toggle';
    input.dataset.tcxSetting = settingKey;
    input.setAttribute('aria-label', t(key));

    label.appendChild(text);
    label.appendChild(input);
    return label;
  }

  _thresholdRow() {
    const row = el('div', 'tcx-xray-panel__row tcx-xray-panel__row--block');

    const head = el('div', 'tcx-xray-panel__slider-head');
    const label = el('span', 'tcx-xray-panel__label', t('settings.threshold'));
    label.dataset.tcxI18n = 'settings.threshold';

    const output = el(
      'output',
      'tcx-xray-panel__output',
      this.getSettings().suspiciousThreshold + '%'
    );
    output.dataset.tcxOutput = 'threshold';

    head.appendChild(label);
    head.appendChild(output);

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'tcx-range';
    range.min = '10';
    range.max = '100';
    range.step = '5';
    range.dataset.tcxSetting = 'suspiciousThreshold';
    this._paintRange(range, this.getSettings().suspiciousThreshold);
    range.dataset.tcxI18n = 'settings.thresholdAria';
    range.dataset.tcxI18nAttr = 'aria-label';
    range.setAttribute('aria-label', t('settings.thresholdAria'));

    const help = this._help('settings.thresholdHelp');

    row.appendChild(head);
    row.appendChild(range);
    row.appendChild(help);
    return row;
  }

  _selectRow(labelKey, settingKey, ariaKey, options) {
    const row = el('label', 'tcx-xray-panel__row');
    const text = el('span', 'tcx-xray-panel__label', t(labelKey));
    text.dataset.tcxI18n = labelKey;

    const select = document.createElement('select');
    select.className = 'tcx-select';
    select.dataset.tcxSetting = settingKey;
    select.dataset.tcxI18n = ariaKey;
    select.dataset.tcxI18nAttr = 'aria-label';
    select.setAttribute('aria-label', t(ariaKey));

    options.forEach((option) => {
      const node = el('option', '', t(option.key));
      node.value = option.value;
      node.dataset.tcxI18n = option.key;
      select.appendChild(node);
    });

    row.appendChild(text);
    row.appendChild(select);
    return row;
  }

  _auditSection() {
    const section = el('div', 'tcx-audit-section');
    section.hidden = !this.getSettings().enableAuditLog;

    const countRow = el('div', 'tcx-audit-count-row');
    const countLabel = el('span', '', t('settings.auditCount'));
    countLabel.dataset.tcxI18n = 'settings.auditCount';
    const countVal = document.createElement('b');
    countVal.dataset.tcxAuditCount = '1';
    countVal.textContent = '0';
    countRow.appendChild(countLabel);
    countRow.appendChild(countVal);
    section.appendChild(countRow);

    const group = el('div', 'tcx-audit-btn-group');

    const copyBtn = el('button', 'tcx-audit-btn', t('settings.copyJson'));
    copyBtn.type = 'button';
    copyBtn.dataset.tcxI18n = 'settings.copyJson';
    copyBtn.addEventListener('click', () => {
      const logger = this.getLogger();
      if (!logger) {
        return;
      }
      const json = logger.getJson(true);
      const clipboard =
        typeof navigator !== 'undefined' ? navigator.clipboard : null;
      if (clipboard && clipboard.writeText) {
        clipboard.writeText(json).then(() => this._flash(copyBtn, 'settings.copyJson'));
      }
    });

    const downloadBtn = el('button', 'tcx-audit-btn', t('settings.download'));
    downloadBtn.type = 'button';
    downloadBtn.dataset.tcxI18n = 'settings.download';
    downloadBtn.addEventListener('click', () => {
      const logger = this.getLogger();
      if (!logger) {
        return;
      }
      const channel =
        window.location.pathname.replace(/^\//, '').split('/')[0] || 'chat';
      logger.downloadJson(channel);
    });

    const clearBtn = el(
      'button',
      'tcx-audit-btn tcx-audit-btn--danger',
      t('settings.clear')
    );
    clearBtn.type = 'button';
    clearBtn.dataset.tcxI18n = 'settings.clear';
    clearBtn.addEventListener('click', () => {
      const logger = this.getLogger();
      if (!logger) {
        return;
      }
      logger.clear();
      setTextIfChanged(countVal, '0');
    });

    group.appendChild(copyBtn);
    group.appendChild(downloadBtn);
    group.appendChild(clearBtn);
    section.appendChild(group);
    return section;
  }

  // ------------------------------------------------------------------- events

  _onInput(event) {
    const target = event.target;
    if (
      !target ||
      !target.dataset ||
      target.dataset.tcxSetting !== 'suspiciousThreshold'
    ) {
      return;
    }

    const output =
      this.modal && this.modal.querySelector('[data-tcx-output="threshold"]');
    if (output) {
      setTextIfChanged(output, target.value + '%');
    }
    this._paintRange(target, target.value);
    this.onPreview(this._collectSettings());
  }

  _onChange(event) {
    const target = event.target;
    if (!target || !target.dataset || !target.dataset.tcxSetting) {
      return;
    }
    this.onCommit(this._collectSettings());
    this.sync();
  }

  _collectSettings() {
    const next = Object.assign({}, this.getSettings());
    if (!this.modal || !this.refs) {
      return next;
    }

    const inputs = this.modal.querySelectorAll('[data-tcx-setting]');
    for (let i = 0; i < inputs.length; i += 1) {
      const input = inputs[i];
      const key = input.dataset.tcxSetting;
      if (key === 'suspiciousThreshold') {
        next[key] = Number(input.value);
      } else if (key === 'r9kAction' || key === 'language') {
        next[key] = input.value;
      } else {
        next[key] = Boolean(input.checked);
      }
    }
    return next;
  }

  _onKeyDown(event) {
    if (!this.open) {
      return;
    }
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      // No stopPropagation(): Twitch's handler runs on a different listener
      // target, so swallowing here would corrupt other components that rely on
      // Escape. Feeding the same key to Twitch just closes the native settings
      // chips behind our dialog, which is the expected result.
      this.close();
    }
  }

  /** Backdrop clicks are handled by the modal itself; this only stops the
   * page's own click handlers from reacting to interactions inside it. */
  _onPointerDown(event) {
    const target = event.target;
    if (
      target &&
      typeof target.closest === 'function' &&
      target.closest('[data-tcx-ui="settings-modal"]')
    ) {
      event.stopPropagation();
    }
  }

  _onDocumentClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') {
      return;
    }
    if (
      target.closest('[data-tcx-ui="settings-modal"]') ||
      target.closest('[data-tcx-ui="settings-button"]')
    ) {
      return;
    }
    if (target.closest('[data-a-target="chat-settings"]')) {
      // Twitch has just opened its popover. It renders a frame or two later,
      // so probe once now and once after paint.
      this.ensureButton();
      window.setTimeout(() => this.ensureMenuRow(), 0);
      window.setTimeout(() => this.ensureMenuRow(), 120);
      window.setTimeout(() => this.ensureMenuRow(), 400);
    }
  }
}

// Cog outline + hub, generated from one path each (24×24 view box).
const GEAR_PATH =
  'M19.14 12.94a7.2 7.2 0 0 0 .06-.94 7.2 7.2 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.62' +
  'l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.8 2.4' +
  'h-3.6a.5.5 0 0 0-.49.42l-.36 2.54c-.58.24-1.13.55-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.82 8.88' +
  'a.5.5 0 0 0 .12.62l2.03 1.58a7.2 7.2 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.62l1.92 3.32a.5.5 0 0 0 .6.22' +
  'l2.39-.96c.49.39 1.04.7 1.62.94l.36 2.54a.5.5 0 0 0 .49.42h3.6a.5.5 0 0 0 .49-.42l.36-2.54' +
  'c.58-.24 1.13-.55 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.62z';
const GEAR_HUB =
  'M12 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4z';

function svgPath(d) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  return path;
}

function root() {
  return (document && document.body) || document.documentElement;
}

export { BUTTON_ID, MENU_ROW_ID, MODAL_ID };
