import { createHeaderButton, createMenuRow } from './settings-entrypoints.ts';
import { findHeaderHost, findSettingsMenuHost, hasNativeToggles } from './twitch-settings-host.ts';
import { setTextIfChanged } from '../shared/ui-utils.ts';
import { t } from '../../i18n/i18n.ts';

/** Owns our entry points inside Twitch and their document listener and timers. */
export class TwitchSettingsIntegration {
  private button: HTMLButtonElement | null = null;
  private buttonHost: Element | null = null;
  private menuRow: HTMLButtonElement | null = null;
  private menuRowHost: Element | null = null;
  private readonly menuProbeTimers = new Set<number>();

  constructor(
    private readonly openModal: () => void,
    private readonly toggle: () => void,
  ) {
    this._onDocumentClick = this._onDocumentClick.bind(this);
  }

  start() {
    document.addEventListener('click', this._onDocumentClick, true);
    this.ensureButton();
  }

  stop() {
    document.removeEventListener('click', this._onDocumentClick, true);
    for (const timer of this.menuProbeTimers) window.clearTimeout(timer);
    this.menuProbeTimers.clear();
    this.button?.remove();
    this.menuRow?.remove();
    this.button = null;
    this.buttonHost = null;
    this.menuRow = null;
    this.menuRowHost = null;
  }

  setExpanded(expanded: boolean, focus = false) {
    this.button?.setAttribute('aria-expanded', String(expanded));
    if (focus) this.button?.focus();
  }

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
    const host = findSettingsMenuHost();
    if (host && this.menuRow && this.menuRow.isConnected && host === this.menuRowHost) {
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

    const row = createMenuRow(() => this.openModal());
    if (hasNativeToggles(host)) {
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
    const host = findHeaderHost();
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
    const button = createHeaderButton(() => this.toggle());
    host.appendChild(button);
    this.button = button;
  }

  _onDocumentClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element) || typeof target.closest !== 'function') {
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
      for (const delay of [0, 120, 400]) {
        const timer = window.setTimeout(() => {
          this.menuProbeTimers.delete(timer);
          this.ensureMenuRow();
        }, delay);
        this.menuProbeTimers.add(timer);
      }
    }
  }
}
