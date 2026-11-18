/*
 * Twitch Chat X-Ray — immediate chat-row visibility.
 *
 * No height/opacity animation: animated collapse made users dizzy and still
 * changed the scroll position. Rows are hidden with `display:none` in the same
 * task (ideally in the MutationObserver callback, before paint).
 *
 * When the user is at the bottom of chat, the scroll container is re-anchored
 * after hiding so the newest messages stay at the bottom instead of jumping.
 */
function findScrollParent(row) {
  if (typeof window === 'undefined' || !row) {
    return null;
  }

  // Twitch uses SimpleBar/custom wrappers around the chat; prefer the known
  // ancestors when they are actually scrollable.
  if (typeof row.closest === 'function') {
    try {
      const known = row.closest(
        '.chat-scrollable-area, .simplebar-content-wrapper, .simplebar-scroll-content, .scrollable-div'
      );
      if (known && known.scrollHeight > known.clientHeight + 1) {
        return known;
      }
    } catch (_error) {
      // Fall through to the generic walk.
    }
  }

  let element = row.parentElement;
  while (element && element !== document.body) {
    try {
      const style = window.getComputedStyle(element);
      const overflowY = style.overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        element.scrollHeight > element.clientHeight + 1
      ) {
        return element;
      }
    } catch (_error) {
      // Detached or unsupported element; keep walking.
    }
    element = element.parentElement;
  }
  return null;
}

export function isRowHidden(row) {
  return Boolean(row && row.dataset && row.dataset.tcxHidden === '1');
}

/**
 * Hide/show a row immediately. Safe to call repeatedly.
 */
export function setRowHidden(row, hidden) {
  if (!row || !row.style) {
    return;
  }
  const target = Boolean(hidden);
  const current = isRowHidden(row);
  if (current === target) {
    return;
  }

  if (target) {
    const scroller = findScrollParent(row);
    const wasAtBottom = scroller
      ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 24
      : false;

    row.style.display = 'none';
    if (row.dataset) {
      row.dataset.tcxHidden = '1';
    }

    // Keep the bottom of chat anchored: the row is gone instantly, but the
    // latest visible messages should not move up.
    if (scroller && wasAtBottom) {
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
    }
    return;
  }

  row.style.display = '';
  if (row.dataset) {
    row.dataset.tcxHidden = '0';
  }
}
