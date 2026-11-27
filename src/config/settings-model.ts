import { normalizeLocale } from '../i18n/i18n.ts';

export interface Settings {
  showBadges: boolean;
  muteSuspicious: boolean;
  hideSuspicious: boolean;
  suspiciousThreshold: number;
  clientR9K: boolean;
  r9kAction: 'hide' | 'mute';
  enableAuditLog: boolean;
  recordSession: boolean;
  adjustViewerCounter: boolean;
  accountAgeLookup: boolean;
  showChatStats: boolean;
  language: '' | 'ru' | 'en';
}

/** Default bot-score threshold, in percent. */
export const DEFAULT_THRESHOLD = 30;

export const DEFAULTS = Object.freeze({
  showBadges: true,
  muteSuspicious: true,
  hideSuspicious: false,
  suspiciousThreshold: DEFAULT_THRESHOLD,
  clientR9K: true,
  r9kAction: 'mute',
  enableAuditLog: false,
  recordSession: false,
  adjustViewerCounter: true,
  accountAgeLookup: false,
  showChatStats: true,
  // '' follows the browser language; 'ru'/'en' pin it.
  language: '',
});

/** Clamp to the slider range (10..100) and round to its 5% step. */
export function clampThreshold(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return DEFAULTS.suspiciousThreshold;
  }
  return Math.min(100, Math.max(10, Math.round(number / 5) * 5));
}

export function normalizeSettings(raw: unknown): Settings {
  const source: Record<string, unknown> = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const settings: Settings = {
    showBadges: source.showBadges !== false,
    muteSuspicious: source.muteSuspicious !== false,
    hideSuspicious: source.hideSuspicious === true,
    suspiciousThreshold: clampThreshold(source.suspiciousThreshold),
    clientR9K: source.clientR9K !== false,
    r9kAction: source.r9kAction === 'hide' ? 'hide' : 'mute',
    enableAuditLog: source.enableAuditLog === true,
    recordSession: source.recordSession === true,
    adjustViewerCounter: source.adjustViewerCounter !== false,
    accountAgeLookup: source.accountAgeLookup === true,
    showChatStats: source.showChatStats !== false,
    language: normalizeLocale(source.language) || '',
  };

  // "Hide" wins over "Mute" when both are somehow set.
  if (settings.hideSuspicious) {
    settings.muteSuspicious = false;
  }

  return settings;
}


/** Compare two normalized settings without depending on object identity. */
export function sameSettings(a: Settings | null | undefined, b: Settings | null | undefined): boolean {
  if (!a || !b) return false;
  return Object.entries(b).every(([key, value]) => Reflect.get(a, key) === value);
}
