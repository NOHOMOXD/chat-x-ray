import { createHeaderButton } from './settings-entrypoints.ts';
import { findHeaderHost } from './twitch-settings-host.ts';
import { tooltipController } from '../shared/tooltip-controller.ts';
import { t } from '../../i18n/i18n.ts';
import type { Instance } from 'tippy.js';

export class TwitchSettingsIntegration {
  private button: HTMLButtonElement | null = null;
  private buttonHost: Element | null = null;
  private tooltip: Instance | null = null;

  constructor(private readonly toggle: () => void) {}

  start() { this.ensureButton(); }

  stop() {
    tooltipController.detach(this.button);
    this.button?.remove();
    this.button = null;
    this.buttonHost = null;
    this.tooltip = null;
  }

  setExpanded(expanded: boolean, focus = false) {
    this.button?.setAttribute('aria-expanded', String(expanded));
    if (expanded) this.tooltip?.hide();
    if (focus) this.button?.focus();
  }

  refreshLabels() {
    if (this.button) {
      this.button.setAttribute('aria-label', t('app.settingsEntry'));
      tooltipController.refresh(this.button);
    }
  }

  ensureButton() {
    const host = findHeaderHost();
    if (this.button && this.button.isConnected && host === this.buttonHost) return;
    tooltipController.detach(this.button);
    this.button?.remove();
    this.button = null;
    this.tooltip = null;
    this.buttonHost = host;
    if (!host) return;
    const button = createHeaderButton(() => this.toggle());
    host.appendChild(button);
    this.button = button;
    this.tooltip = tooltipController.attach(button, () => {
      const label = document.createElement('span');
      label.textContent = t('app.settingsEntry');
      return label;
    });
  }
}
