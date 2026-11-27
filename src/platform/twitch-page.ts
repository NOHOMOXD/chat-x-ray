const MESSAGE_CONTAINER_SELECTOR =
  '[data-test-selector="chat-scrollable-area__message-container"], ' +
  '.chat-scrollable-area__message-container';

const RESERVED_PATHS = new Set([
  '',
  'directory',
  'search',
  'settings',
  'subscriptions',
  'inventory',
  'wallet',
  'drops',
  'friends',
  'turbo',
  'videos',
  'downloads',
  'jobs',
  'p',
  'legal',
  'privacy',
  'store',
  'creatorcamp',
  'moderator',
]);

export function getChannelSlug() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (!parts.length) {
    return '';
  }

  const first = (parts[0] || '').toLowerCase();
  if (first === 'popout' || first === 'embed') {
    return (parts[1] || '').toLowerCase();
  }
  if (RESERVED_PATHS.has(first)) {
    return '';
  }
  return first;
}

function isVisible(element: Element | undefined) {
  if (!element || !element.isConnected) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    Number(style.opacity) !== 0
  );
}

export function findMessageContainer() {
  const nodes = document.querySelectorAll(MESSAGE_CONTAINER_SELECTOR);
  for (let i = 0; i < nodes.length; i += 1) {
    if (isVisible(nodes[i])) {
      return nodes[i];
    }
  }

  const row = document.querySelector(
    '.chat-line__message, [data-test-selector="chat-line-message"]'
  );
  if (row) {
    const candidate = row.closest(MESSAGE_CONTAINER_SELECTOR);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

/**
 * The language the viewer reads Twitch in. Twitch puts it on <html lang>, and
 * it is not the same thing as the browser language: people routinely run the
 * browser in one language and Twitch in another. Capture it before this
 * extension touches the page, then use it for "auto".
 */
export function readTwitchLang() {
  try {
    return document && document.documentElement
      ? String(document.documentElement.lang || '')
      : '';
  } catch (_error) {
    return '';
  }
}

