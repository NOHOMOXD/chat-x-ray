import { t } from '../../i18n/i18n.ts';

export const BUTTON_ID = 'tcx-settings-button';
export const MODAL_ID = 'tcx-settings-modal';
export const MENU_ROW_ID = 'tcx-settings-menu-row';

export function createMenuRow(openModal: () => void) {
  const row = document.createElement('button');
  row.type = 'button';
  row.id = MENU_ROW_ID;
  row.className = 'tcx-settings-row';
  row.dataset.tcxUi = 'settings-menu-row';
  row.setAttribute('data-test-selector', 'tcx-settings-menu-row');
  row.setAttribute('aria-haspopup', 'dialog');
  row.setAttribute('aria-controls', MODAL_ID);

  const label = document.createElement('span');
  label.className = 'tcx-settings-row__label';
  label.dataset.tcxI18n = 'app.settingsEntry';
  label.textContent = t('app.settingsEntry');

  row.appendChild(label);

  row.addEventListener('click', (event) => {
    // Stop Twitch's menu from closing and swallowing the click.
    event.preventDefault();
    event.stopPropagation();
    openModal();
  });

  return row;
}

export function createHeaderButton(toggle: () => void) {
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
    toggle();
  });
  return button;
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

function svgPath(d: string) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  return path;
}

