/*
 * Twitch Chat X-Ray — WebSocket message → native DOM row binder.
 * Matches rows by login/display name, message text (including emote alt text),
 * and arrival order. Manages pending queue and delegates to MessageRow.
 */
import { MessageRow, resolveRowMode } from './message-row.js';
import { setRowHidden } from './row-visibility.js';

const MESSAGE_ROW_SELECTOR =
  '.chat-line__message, [data-test-selector="chat-line-message"]';
const MESSAGE_BODY_SELECTOR =
  '[data-a-target="chat-line-message-body"], ' +
  '.chat-line__message-body, ' +
  '[data-test-selector="chat-line-message-body"]';
const AUTHOR_SELECTOR =
  '[data-a-target="chat-message-username"], ' +
  '.chat-author__display-name, ' +
  '.chat-line__username';

function collapseWhitespace(value) {
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(value) {
  let text = String(value || '');
  try {
    text = text.normalize('NFC');
  } catch (_error) {
    // Non-fatal
  }
  return collapseWhitespace(
    text
      .toLowerCase()
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u207F\uFEFF\u00AD]/g, '')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
  );
}

function compactForMatch(value) {
  return normalizeForMatch(value).replace(/[\s\p{P}\p{S}]/gu, '');
}

function messageTextFromNode(node) {
  if (!node) {
    return '';
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue || '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const tagName = node.tagName;
  if (tagName === 'IMG') {
    return node.getAttribute('alt') || node.getAttribute('title') || '';
  }
  if (tagName === 'BR') {
    return ' ';
  }
  if (tagName === 'SCRIPT' || tagName === 'STYLE') {
    return '';
  }

  let output = '';
  for (let child = node.firstChild; child; child = child.nextSibling) {
    output += messageTextFromNode(child);
  }
  return output;
}

function extractDisplayName(row) {
  const node = row.querySelector(AUTHOR_SELECTOR);
  return node ? collapseWhitespace(node.textContent) : '';
}

function extractLogin(row) {
  let raw = row.getAttribute('data-a-user');
  if (!raw) {
    const owner = row.querySelector('[data-a-user]');
    if (owner) {
      raw = owner.getAttribute('data-a-user');
    }
  }

  const login = collapseWhitespace(raw || '').toLowerCase();
  return login || extractDisplayName(row).toLowerCase();
}

function extractMessageText(row) {
  const body = row.querySelector(MESSAGE_BODY_SELECTOR);
  if (body) {
    return collapseWhitespace(messageTextFromNode(body));
  }

  const fragments = row.querySelectorAll('.text-fragment');
  if (fragments.length) {
    let joined = '';
    for (let i = 0; i < fragments.length; i += 1) {
      joined += fragments[i].textContent + ' ';
    }
    return collapseWhitespace(joined);
  }

  const clone = row.cloneNode(true);
  const removable = clone.querySelectorAll(
    '.chat-line__message--badges, ' +
      AUTHOR_SELECTOR +
      ', .chat-line__timestamp, [data-test-selector="chat-line-message-body"] button, button'
  );
  for (let j = 0; j < removable.length; j += 1) {
    removable[j].remove();
  }
  return collapseWhitespace(clone.textContent);
}

export class MessageBinder {
  constructor(options) {
    this.getSettings = options.getSettings;
    this.pending = new Map();
    this.rows = new Map();
    this.rowAttempts = new WeakMap();
    this.rowFirstSeen = new WeakMap();
  }

  reset() {
    this.rows.forEach((view) => {
      view.destroy();
    });
    this.rows.clear();
    this.pending.clear();
    this.rowAttempts = new WeakMap();
    this.rowFirstSeen = new WeakMap();
  }

  addPending(record) {
    if (!record || record._domBound) {
      return;
    }

    record._pendingAt = Date.now();
    record._pendingKeys = this._pendingKeys(record);
    for (let i = 0; i < record._pendingKeys.length; i += 1) {
      const key = record._pendingKeys[i];
      let list = this.pending.get(key);
      if (!list) {
        list = [];
        this.pending.set(key, list);
      }
      list.push(record);
    }
  }

  prunePending() {
    const cutoff = Date.now() - 90000;

    this.pending.forEach((list, key) => {
      const kept = [];
      for (let i = 0; i < list.length; i += 1) {
        const record = list[i];
        if (record._domBound) {
          continue;
        }
        if (record._pendingAt >= cutoff) {
          kept.push(record);
        }
      }
      if (kept.length) {
        this.pending.set(key, kept);
      } else {
        this.pending.delete(key);
      }
    });
  }

  bindRows(container) {
    if (!container) {
      return;
    }

    const rows = container.querySelectorAll(MESSAGE_ROW_SELECTOR);
    const now = Date.now();

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row.isConnected || row.dataset.tcxBound) {
        continue;
      }

      let firstSeen = this.rowFirstSeen.get(row);
      if (!firstSeen) {
        firstSeen = now;
        this.rowFirstSeen.set(row, now);
      }
      if (now - firstSeen > 60000) {
        row.dataset.tcxBound = '2'; // stop retrying old rows
        continue;
      }

      const attempt = this.rowAttempts.get(row);
      if (attempt && now - attempt < 600) {
        continue;
      }
      this.rowAttempts.set(row, now);

      const login = extractLogin(row);
      if (!login) {
        continue;
      }

      const record = this._findPendingRecord(
        login,
        extractDisplayName(row),
        extractMessageText(row)
      );
      if (record) {
        this._bindRow(row, record);
      }
    }
  }

  /**
   * Hide suspicious/R9K rows in the MutationObserver callback, before the
   * browser paints the newly inserted row. The record is already pending when
   * the synchronous MAIN→ISOLATED bridge delivered the message first.
   */
  fastHideMutations(mutations) {
    const settings = this.getSettings();
    if (!settings) {
      return;
    }
    const hideSuspicious = settings.hideSuspicious === true;
    const hideR9K =
      settings.clientR9K === true && settings.r9kAction === 'hide';
    if (!hideSuspicious && !hideR9K) {
      return;
    }

    const rows = new Set();
    const collect = (node) => {
      if (!node || node.nodeType !== 1) {
        return;
      }
      if (typeof node.matches === 'function' && node.matches(MESSAGE_ROW_SELECTOR)) {
        rows.add(node);
      }
      if (typeof node.querySelectorAll === 'function') {
        const nested = node.querySelectorAll(MESSAGE_ROW_SELECTOR);
        for (let i = 0; i < nested.length; i += 1) {
          rows.add(nested[i]);
        }
      }
    };

    for (let i = 0; i < mutations.length; i += 1) {
      const added = mutations[i].addedNodes;
      if (!added) {
        continue;
      }
      for (let j = 0; j < added.length; j += 1) {
        collect(added[j]);
      }
    }

    rows.forEach((row) => {
      if (!row.isConnected || row.dataset.tcxBound) {
        return;
      }
      const login = extractLogin(row);
      if (!login) {
        return;
      }
      const record = this._findPendingRecord(
        login,
        extractDisplayName(row),
        extractMessageText(row)
      );
      if (!record) {
        return;
      }

      if (resolveRowMode(record, settings) === 'hide') {
        row.dataset.tcxFastHidden = '1';
        row.classList.add('tcx-hidden');
        setRowHidden(row, true);
      }
    });
  }

  refresh() {
    const settings = this.getSettings();
    this.rows.forEach((view, row) => {
      if (!row.isConnected) {
        view.destroy();
        this.rows.delete(row);
        return;
      }
      view.apply(settings);
    });
  }

  cleanup() {
    this.rows.forEach((view, row) => {
      if (!row.isConnected) {
        view.destroy();
        this.rows.delete(row);
      }
    });
  }

  _bindRow(row, record) {
    this._removePending(record);
    record._domBound = true;

    delete row.dataset.tcxFastHidden;
    const view = new MessageRow(row, record);
    this.rows.set(row, view);
    view.apply(this.getSettings());
  }

  _pendingKeys(record) {
    const keys = [];
    const login = String(record.login || '').toLowerCase();
    const displayName = String(record.displayName || '').toLowerCase();
    if (login) {
      keys.push(login);
    }
    if (displayName && displayName !== login) {
      keys.push(displayName);
    }
    return keys;
  }

  _removePending(record) {
    if (!record || !record._pendingKeys) {
      return;
    }

    for (let i = 0; i < record._pendingKeys.length; i += 1) {
      const key = record._pendingKeys[i];
      const list = this.pending.get(key);
      if (!list) {
        continue;
      }
      const index = list.indexOf(record);
      if (index !== -1) {
        list.splice(index, 1);
      }
      if (!list.length) {
        this.pending.delete(key);
      }
    }
    record._pendingKeys = [];
  }

  _getPendingCandidates(login, displayName) {
    const keys = [];
    if (login) {
      keys.push(login);
    }
    if (displayName) {
      keys.push(displayName.toLowerCase());
    }

    const seen = new Set();
    const candidates = [];
    for (let i = 0; i < keys.length; i += 1) {
      const list = this.pending.get(keys[i]);
      if (!list) {
        continue;
      }
      for (let j = 0; j < list.length; j += 1) {
        const record = list[j];
        if (!seen.has(record)) {
          seen.add(record);
          candidates.push(record);
        }
      }
    }

    candidates.sort((a, b) => a.ts - b.ts);
    return candidates;
  }

  _findPendingRecord(login, displayName, text) {
    const candidates = this._getPendingCandidates(login, displayName);
    if (!candidates.length) {
      return null;
    }

    const target = normalizeForMatch(text);
    if (target) {
      for (let i = 0; i < candidates.length; i += 1) {
        if (normalizeForMatch(candidates[i].text) === target) {
          return candidates[i];
        }
      }

      const compactTarget = compactForMatch(text);
      if (compactTarget) {
        for (let j = 0; j < candidates.length; j += 1) {
          if (compactForMatch(candidates[j].text) === compactTarget) {
            return candidates[j];
          }
        }
      }
    }

    // Fallback: match oldest pending record from this author
    for (let k = 0; k < candidates.length; k += 1) {
      if (Date.now() - candidates[k]._pendingAt <= 45000) {
        return candidates[k];
      }
    }

    return null;
  }
}
