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
];
const SETTINGS_ROW_SELECTOR = 'button, [role="menuitem"], [role="button"], a';

export function findHeaderHost() {
  for (const selector of CHAT_HEADER_SELECTORS) {
    const node = document.querySelector(selector);
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
export function findSettingsMenuHost() {
  const gear = document.querySelector(GEAR_SELECTOR);
  // The popover only exists while the gear menu is open.
  if (!gear) {
    return null;
  }

  for (const selector of SETTINGS_PANEL_SELECTORS) {
    const nodes = document.querySelectorAll(selector);
    for (const panel of nodes) {
      if (!panel || !panel.isConnected || panel.closest('[data-tcx-ui="settings-modal"]')) {
        continue;
      }
      const rect = panel.getBoundingClientRect ? panel.getBoundingClientRect() : null;
      if (!rect || rect.width < 160 || rect.height < 80) {
        continue;
      }
      return resolveRowContainer(panel);
    }
  }
  const controlledId = gear.getAttribute('aria-controls');
  const dialog = controlledId ? document.getElementById(controlledId) : null;
  if (dialog?.matches('[role="dialog"]') && dialog.isConnected) {
    const rect = dialog.getBoundingClientRect();
    if (rect.width >= 160 && rect.height >= 80) return resolveRowContainer(dialog);
  }
  return null;
}

/** Where inside the popover to append: after the last option, not in a header. */
function resolveRowContainer(panel: Element) {
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
  let node = last.parentElement;
  while (node && node !== panel) {
    const optionCount = node.querySelectorAll(SETTINGS_ROW_SELECTOR).length;
    const isWrapperOfOne = node === last.parentElement && optionCount < 2;
    if (optionCount >= 2 && !isWrapperOfOne) {
      return node;
    }
    node = node.parentElement;
  }
  // Flat popover: options sit directly in the panel.
  return panel;
}

/** True when the native menu renders toggle rows, so our row can match. */
export function hasNativeToggles(host: Element | null) {
  return Boolean(
    host &&
      host.querySelector &&
      host.querySelector(
        'input[type="checkbox"], [role="switch"], [role="checkbox"]'
      )
  );
}

