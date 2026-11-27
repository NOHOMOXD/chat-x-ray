import type { Settings } from '../../config/settings-model.ts';
import type { BotLogger } from '../../config/bot-logger.ts';
import { BUTTON_ID, MENU_ROW_ID, MODAL_ID } from './settings-entrypoints.ts';
import { TwitchSettingsIntegration } from './twitch-settings-integration.ts';
import { downloadJson } from '../shared/download-json.ts';
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
import { DEFAULTS } from '../../config/settings.ts';
import { setTextIfChanged } from '../shared/ui-utils.ts';
import { t } from '../../i18n/i18n.ts';


function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

type BooleanSetting = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
const BOOLEAN_SETTINGS: ReadonlySet<string> = new Set([
  'showBadges', 'muteSuspicious', 'hideSuspicious', 'clientR9K', 'enableAuditLog',
  'recordSession', 'adjustViewerCounter', 'accountAgeLookup', 'showChatStats',
]);
function isBooleanSetting(key: string | undefined): key is BooleanSetting {
  return key !== undefined && BOOLEAN_SETTINGS.has(key);
}

interface SettingsOptions {
  getSettings: () => Settings;
  onCommit: (settings: Settings) => void;
  onPreview?: (settings: Settings) => void;
  getLogger?: () => BotLogger | null;
  clearHistory?: () => Promise<unknown>;
  downloadSession?: (previous: boolean) => void;
}

export class SettingsModal {
  private readonly getSettings: SettingsOptions['getSettings'];
  private readonly onCommit: SettingsOptions['onCommit'];
  private readonly onPreview: NonNullable<SettingsOptions['onPreview']>;
  private readonly getLogger: NonNullable<SettingsOptions['getLogger']>;
  private readonly clearHistory: SettingsOptions['clearHistory'];
  private readonly downloadSession: NonNullable<SettingsOptions['downloadSession']>;
  private sessionAvailability: [boolean, boolean];
  private readonly integration: TwitchSettingsIntegration;
  private modal: HTMLElement | null;
  private refs: object | null;
  private open: boolean;

  constructor(options: SettingsOptions) {
    this.getSettings = options.getSettings;
    this.onCommit = options.onCommit;
    this.onPreview = options.onPreview || (() => {});
    this.getLogger = options.getLogger || (() => null);
    this.clearHistory = options.clearHistory;
    this.downloadSession = options.downloadSession || (() => {});
    this.sessionAvailability = [false, false];
    this.integration = new TwitchSettingsIntegration(
      () => this.openModal(), () => this.toggle()
    );

    this.modal = null;
    this.refs = null;
    this.open = false;

    this._onInput = this._onInput.bind(this);
    this._onChange = this._onChange.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    this.integration.start();
  }

  stop() {
    this.close();
    this.integration.stop();
  }

  ensureMenuRow() {
    return this.integration.ensureMenuRow();
  }

  ensureButton() {
    this.integration.ensureButton();
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
    this.integration.setExpanded(true);
    const close = modal.querySelector<HTMLButtonElement>('[data-tcx-close]');
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
    this.integration.setExpanded(false, true);
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
    this.integration.refreshLabels();
    if (!this.modal) {
      return;
    }
    const modal = this.modal;
    modal.setAttribute('aria-label', t('settings.title'));
    const nodes = modal.querySelectorAll<HTMLElement>('[data-tcx-i18n]');
    for (const node of nodes) {
      const key = node.dataset.tcxI18n;
      const attr = node.dataset.tcxI18nAttr;
      if (!key) continue;
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
    const inputs = this.modal.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-tcx-setting]');
    for (const input of inputs) {
      const key = input.dataset.tcxSetting;
      if (key === 'suspiciousThreshold' && input instanceof HTMLInputElement) {
        const value = String(settings.suspiciousThreshold);
        if (input.value !== value) input.value = value;
        this._paintRange(input, settings.suspiciousThreshold);
      } else if (key === 'r9kAction' || key === 'language') {
        if (input.value !== settings[key]) input.value = settings[key];
        if (key === 'r9kAction') input.disabled = !settings.clientR9K;
      } else if (isBooleanSetting(key) && input instanceof HTMLInputElement) {
        const checked = settings[key];
        if (input.checked !== checked) input.checked = checked;
      }
    }

    const output = this.modal.querySelector('[data-tcx-output="threshold"]');
    if (output) {
      setTextIfChanged(output, settings.suspiciousThreshold + '/100');
    }

    const auditSection = this.modal.querySelector<HTMLElement>('.tcx-audit-section');
    if (auditSection) {
      const shouldHide = !settings.enableAuditLog;
      if (auditSection.hidden !== shouldHide) {
        auditSection.hidden = shouldHide;
      }
      this.syncAuditCount();
    }
  }

  syncSessionButtons(current: boolean, previous: boolean) {
    this.sessionAvailability = [current, previous];
    this.modal?.querySelectorAll<HTMLButtonElement>('[data-tcx-session-export]').forEach((button) => {
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
  _flash(button: HTMLElement, key: string) {
    const original = t(key);
    setTextIfChanged(button, t('settings.copied'));
    window.setTimeout(() => {
      if (button.isConnected) {
        setTextIfChanged(button, original);
      }
    }, 1500);
  }

  // ----------------------------------------------------------------- creation

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
    const clearHistory = this.clearHistory;
    if (clearHistory) {
      const clear = el('button', 'tcx-audit-btn', t('settings.clearHistory'));
      const status = el('span');
      status.setAttribute('role', 'status');
      clear.type = 'button';
      clear.dataset.tcxI18n = 'settings.clearHistory';
      clear.addEventListener('click', async () => {
        clear.disabled = true;
        try {
          await clearHistory();
          status.textContent = t('settings.historyCleared');
        } catch {
          status.textContent = t('settings.historyClearFailed');
        } finally {
          clear.disabled = false;
        }
      });
      exports.append(clear, status);
    }
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
    // A real button, not a dead gradient: it scrolls the panel to the end.
    const more = el('button', 'tcx-modal__more', t('settings.scrollMore'));
    more.type = 'button';
    more.dataset.tcxI18n = 'settings.scrollMore';
    more.addEventListener('click', () => this._scrollToEnd());
    scroller.appendChild(body);
    scroller.appendChild(more);
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
    this.onCommit({ ...this.getSettings(), ...DEFAULTS });
    this.sync();
  }

  _sectionLabel(key: string) {
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
    const more =
      body.scrollHeight - body.scrollTop - body.clientHeight > 8;
    this.modal.classList.toggle('tcx-modal--scrollable', more);
  }

  _scrollToEnd() {
    if (!this.modal) {
      return;
    }
    const body = this.modal.querySelector('.tcx-modal__body');
    if (!body) {
      return;
    }
    const top = Math.max(0, body.scrollHeight - body.clientHeight);
    if (typeof body.scrollTo === 'function') {
      body.scrollTo({ top, behavior: 'smooth' });
    } else {
      body.scrollTop = top;
    }
  }

  /** Keep the purple fill of the threshold slider in sync with its value. */
  _paintRange(range: HTMLInputElement, value: number | string) {
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

  _help(key: string) {
    const help = el('p', 'tcx-xray-panel__help', t(key));
    help.dataset.tcxI18n = key;
    return help;
  }

  _toggleRow(key: string, settingKey: string) {
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
      this.getSettings().suspiciousThreshold + '/100'
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

  _selectRow(labelKey: string, settingKey: string, ariaKey: string, options: Array<{ value: string; key: string }>) {
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
      downloadJson(logger.getJson(true), 'twitch-xray-audit', channel);
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

  _onInput(event: Event) {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) ||
      target.dataset.tcxSetting !== 'suspiciousThreshold'
    ) {
      return;
    }

    const output =
      this.modal && this.modal.querySelector('[data-tcx-output="threshold"]');
    if (output) {
      setTextIfChanged(output, target.value + '/100');
    }
    this._paintRange(target, target.value);
    this.onPreview(this._collectSettings());
  }

  _onChange(event: Event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.dataset.tcxSetting) {
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

    const inputs = this.modal.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-tcx-setting]');
    for (const input of inputs) {
      const key = input.dataset.tcxSetting;
      if (key === 'suspiciousThreshold') {
        next.suspiciousThreshold = Number(input.value);
      } else if (key === 'r9kAction' && (input.value === 'mute' || input.value === 'hide')) {
        next.r9kAction = input.value;
      } else if (key === 'language' && (input.value === '' || input.value === 'ru' || input.value === 'en')) {
        next.language = input.value;
      } else if (isBooleanSetting(key) && input instanceof HTMLInputElement) {
        next[key] = input.checked;
      }
    }
    return next;
  }

  _onKeyDown(event: KeyboardEvent) {
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
  _onPointerDown(event: PointerEvent) {
    const target = event.target;
    if (
      target instanceof Element &&
      typeof target.closest === 'function' &&
      target.closest('[data-tcx-ui="settings-modal"]')
    ) {
      event.stopPropagation();
    }
  }

}


function root() {
  return (document && document.body) || document.documentElement;
}

export { BUTTON_ID, MENU_ROW_ID, MODAL_ID };
