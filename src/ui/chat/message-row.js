/*
 * Twitch Chat X-Ray — one bound chat row.
 * Visual lifecycle of a single native Twitch message:
 * the bot badge, muted/hidden classes and debug attributes.
 */

import { isSuspicious } from '../../core/chat-session.js';
import { botHue, setTextIfChanged } from '../shared/ui-utils.js';
import { setRowHidden } from './row-visibility.js';
import {
  buildBadgeTooltip,
  tooltipController,
  triggerLabel,
} from '../shared/tooltip-controller.js';
import { t } from '../../i18n/i18n.js';

const AUTHOR_SELECTOR =
  '[data-a-target="chat-message-username"], ' +
  '.chat-author__display-name, ' +
  '.chat-line__username';

export function resolveRowMode(record, settings) {
  const threshold = settings.suspiciousThreshold;
  const suspicious = isSuspicious(record, threshold);
  let mode = 'none';

  if (suspicious) {
    if (settings.hideSuspicious) {
      mode = 'hide';
    } else if (settings.muteSuspicious) {
      mode = 'mute';
    }
  }

  if (
    settings.clientR9K &&
    (record.isR9KDuplicate || record.spamFlood)
  ) {
    if (settings.r9kAction === 'hide') {
      mode = 'hide';
    } else if (mode !== 'hide') {
      mode = 'mute';
    }
  }

  return mode;
}

/**
 * Records that received the bot-wave bonus are drawn in red, so the same
 * passive signal a bot wave gives to the header counter is visible on the
 * affected messages too.
 */
export function isWaveRecord(record) {
  if (!record || !record.waveBoost) {
    return false;
  }
  const triggers = record.triggers || [];
  for (let i = 0; i < triggers.length; i += 1) {
    if (triggers[i] && triggers[i].key === 'wave') {
      return true;
    }
  }
  return false;
}

export class MessageRow {
  constructor(row, record) {
    this.row = row;
    this.record = record;
    this.row.dataset.tcxBound = '1';
  }

  get isConnected() {
    return Boolean(this.row && this.row.isConnected);
  }

  apply(settings) {
    if (!this.isConnected) {
      return;
    }

    this.settings = settings;
    const mode = resolveRowMode(this.record, settings);
    const threshold = settings.suspiciousThreshold;

    this.row.classList.toggle('tcx-muted', mode === 'mute');
    this.row.classList.toggle('tcx-hidden', mode === 'hide');
    // Immediate hide: no height animation. The fast-hide pass in MessageBinder
    // can do this even earlier, in the MutationObserver callback.
    setRowHidden(this.row, mode === 'hide');
    this.row.dataset.tcxBotScore = String(this.record.botScore);
    this.row.dataset.tcxR9k = this.record.isR9KDuplicate ? '1' : '0';
    this.row.dataset.tcxWave = isWaveRecord(this.record) ? '1' : '0';

    const idGroup = settings.getIdGroup?.(this.record.numericUserId);
    if (settings.showBadges && (this.record.botScore >= threshold || idGroup)) {
      this._ensureBadge(threshold, idGroup);
    } else {
      this._removeBadge();
    }
  }

  destroy() {
    if (!this.row) {
      return;
    }
    this._removeBadge();
    setRowHidden(this.row, false);
    this.row.classList.remove('tcx-muted', 'tcx-hidden');
    delete this.row.dataset.tcxBound;
    delete this.row.dataset.tcxBotScore;
    delete this.row.dataset.tcxR9k;
    delete this.row.dataset.tcxWave;
  }

  _removeBadge() {
    const badge = this.row.querySelector('.tcx-bot-badge');
    if (badge) {
      tooltipController.detach(badge);
      badge.remove();
    }
  }

  _ensureBadge(threshold, idGroup) {
    let badge = this.row.querySelector('.tcx-bot-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tcx-bot-badge';
      badge.setAttribute('role', 'img');
      badge.tabIndex = 0;
      badge.dataset.tcxUi = 'badge';

      const username = this.row.querySelector(AUTHOR_SELECTOR);
      if (username && username.parentNode) {
        username.parentNode.insertBefore(badge, username);
      } else {
        const nativeBadges = this.row.querySelector('.chat-line__message--badges');
        if (nativeBadges) {
          nativeBadges.appendChild(badge);
        } else {
          this.row.prepend(badge);
        }
      }
    }

    const score = this.record.botScore;
    const minThreshold = Number.isFinite(threshold) ? threshold : 50;
    const hue = botHue(score, minThreshold);
    const wave = isWaveRecord(this.record);
    const neutral = !isSuspicious(this.record, threshold);
    const groupOnly = score < threshold;

    setTextIfChanged(badge, groupOnly ? 'ID' : neutral ? String(score) : t('tip.badge.points', { score }));
    badge.classList.toggle('tcx-bot-badge--id-group', neutral);
    badge.dataset.tcxScore = String(score);
    badge.style.setProperty('--tcx-bot-hue', String(hue));
    badge.classList.toggle('tcx-bot-badge--wave', wave && !neutral);

    const triggers = (this.record.triggers || [])
      .filter((tr) => tr && (tr.labelKey || tr.label))
      .map((tr) => triggerLabel(tr) + (tr.points ? ` (+${tr.points})` : ''))
      .join(' • ');

    badge.setAttribute(
      'aria-label',
      groupOnly ? t('tip.idGroups') : neutral ? t('tip.neutral') + ' ' + score : t('tip.badge.scoreAria', {
        score,
        triggers: triggers || t('tip.badge.noTriggers'),
      })
    );

    if (!badge.dataset.tcxTipAttached) {
      badge.dataset.tcxTipAttached = '1';
      tooltipController.attach(badge, () =>
        buildBadgeTooltip({
          score: this.record.botScore,
          threshold: this.settings.suspiciousThreshold,
          triggers: this.record.triggers || [],
          isR9KDuplicate: this.record.isR9KDuplicate,
          spamFlood: this.record.spamFlood,
          accountAgeDays: this.record.accountAgeDays,
          idGroup: this.settings.getIdGroup?.(this.record.numericUserId),
          groupHistory: this.settings.getGroupHistory?.(this.record.numericUserId),
          observedBroadcasts: this.settings.observedBroadcasts,
          groupOnly: this.record.botScore < this.settings.suspiciousThreshold,
          neutral: !isSuspicious(this.record, this.settings.suspiciousThreshold),
          r9kSimilarity: this.record.r9kSimilarity,
          roleExempt: this.record.roleExempt,
          clientR9K: this.settings.clientR9K,
          isBotWave: wave,
        })
      );
    } else {
      tooltipController.refresh(badge);
    }
  }
}
