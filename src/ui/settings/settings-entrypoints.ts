import { t } from '../../i18n/i18n.ts';

export const BUTTON_ID = 'tcx-settings-button';
export const MODAL_ID = 'tcx-settings-modal';
export function createHeaderButton(toggle: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = BUTTON_ID;
  button.className = 'tcx-settings-button';
  button.dataset.tcxUi = 'settings-button';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', MODAL_ID);
  button.setAttribute('aria-label', t('app.settingsEntry'));
  const icon = document.createElement('span');
  icon.className = 'tcx-settings-button__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.style.maskImage = `url("${chrome.runtime.getURL('icons/chat-xray-toolbar.svg')}")`;
  button.appendChild(icon);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggle();
  });
  return button;
}

