import { isWaveRecord, resolveRowMode } from './row-mode.ts';
/*
 * Twitch Chat X-Ray — one bound chat row.
 * Visual lifecycle of a single native Twitch message:
 * the bot badge, muted/hidden classes and debug attributes.
 */

import { isSuspicious } from '../../core/chat-session.ts';
import { botHue, setTextIfChanged } from '../shared/ui-utils.ts';
import { setRowHidden } from './row-visibility.ts';
import { tooltipController } from '../shared/tooltip-controller.ts';
import { buildBadgeTooltip, triggerLabel } from '../shared/tooltip-badge.ts';
import type { IdGroup, GroupHistory } from '../shared/tooltip-badge.ts';
import { t } from '../../i18n/i18n.ts';

const AUTHOR_SELECTOR =
  '[data-a-target="chat-message-username"], ' +
  '.chat-author__display-name, ' +
  '.chat-line__username';

interface BadgeTrigger {
  key: string;
  labelKey?: string;
  label?: string;
  points?: number;
}

export interface MessageRecord {
  botScore: number;
  numericUserId: number | null;
  botConfirmation?: { score: number; triggers?: BadgeTrigger[] } | null;
  triggers?: BadgeTrigger[];
  isR9KDuplicate?: boolean;
  spamFlood?: boolean;
  waveBoost?: boolean;
  roleExempt?: boolean;
  serviceBot?: boolean;
  accountAgeDays?: number | null;
  r9kSimilarity?: number;
}

export interface MessageSettings {
  showBadges: boolean;
  suspectAction: 'keep' | 'mute' | 'hide';
  suspiciousThreshold: number;
  r9kAction: 'keep' | 'mute' | 'hide';
  getIdGroup?: (id: number | null) => IdGroup | undefined;
  getGroupHistory?: (id: number | null) => GroupHistory | undefined;
  observedBroadcasts?: number | undefined;
}

export class MessageRow {
  private settings: MessageSettings | null = null;

  constructor(private readonly row: HTMLElement, private readonly record: MessageRecord) {
    this.row.dataset.tcxBound = '1';
  }

  get isConnected() {
    return Boolean(this.row && this.row.isConnected);
  }

  apply(settings: MessageSettings) {
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
    if (settings.showBadges && (this.record.botConfirmation || this.record.botScore >= threshold || idGroup)) {
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
    const badge = this.row.querySelector<HTMLElement>('.tcx-bot-badge');
    if (badge) {
      tooltipController.detach(badge);
      badge.remove();
    }
  }

  _ensureBadge(threshold: number, idGroup: unknown) {
    const initialSettings = this.settings;
    if (!initialSettings) return;
    let badge = this.row.querySelector<HTMLElement>('.tcx-bot-badge');
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

    const score = this.record.botConfirmation?.score ?? this.record.botScore;
    const minThreshold = Number.isFinite(threshold) ? threshold : 50;
    const hue = botHue(score, minThreshold);
    const wave = isWaveRecord(this.record);
    const neutral = !isSuspicious(this.record, threshold);
    const groupOnly = neutral && score < threshold;

    setTextIfChanged(badge, groupOnly ? 'ID' : neutral ? score + '?' : t('tip.badge.points', { score }));
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
      tooltipController.attach(badge, () => {
        const settings = this.settings ?? initialSettings;
        return buildBadgeTooltip({
          score: this.record.botConfirmation?.score ?? this.record.botScore,
          threshold: settings.suspiciousThreshold,
          triggers: this.record.botConfirmation?.triggers ?? this.record.triggers ?? [],
          isR9KDuplicate: this.record.isR9KDuplicate,
          spamFlood: this.record.spamFlood,
          accountAgeDays: this.record.accountAgeDays,
          idGroup: settings.getIdGroup?.(this.record.numericUserId),
          groupHistory: settings.getGroupHistory?.(this.record.numericUserId),
          observedBroadcasts: settings.observedBroadcasts,
          groupOnly: !this.record.botConfirmation && this.record.botScore < settings.suspiciousThreshold,
          neutral: !isSuspicious(this.record, settings.suspiciousThreshold),
          r9kSimilarity: this.record.r9kSimilarity,
          roleExempt: this.record.roleExempt,
          clientR9K: true,
          isBotWave: wave,
        });
      });
    } else {
      tooltipController.refresh(badge);
    }
  }
}
