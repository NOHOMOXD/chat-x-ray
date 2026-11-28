import { normalizeLocale } from '../i18n/i18n.ts';

export interface Settings {
  showBadges: boolean;
  suspectAction: 'keep' | 'mute' | 'hide';
  suspiciousThreshold: number;
  r9kAction: 'keep' | 'hide' | 'mute';
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
  suspectAction: 'keep',
  suspiciousThreshold: DEFAULT_THRESHOLD,
  r9kAction: 'keep',
  enableAuditLog: false,
  recordSession: false,
  adjustViewerCounter: true,
  accountAgeLookup: true,
  showChatStats: true,
  // '' follows the browser language; 'ru'/'en' pin it.
  language: '',
});

/** Accept only the supported threshold presets. */
export function clampThreshold(value: unknown) {
  const number = Number(value);
  return [10, 30, 50, 70].includes(number) ? number : DEFAULT_THRESHOLD;
}

export function normalizeSettings(raw: unknown): Settings {
  const source: Record<string, unknown> = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const settings: Settings = {
    showBadges: source.showBadges !== false,
    suspectAction: source.suspectAction === 'hide' || source.suspectAction === 'mute' || source.suspectAction === 'keep'
      ? source.suspectAction
      : source.hideSuspicious === true ? 'hide' :
        source.muteSuspicious === true || (source.muteSuspicious !== false && 'hideSuspicious' in source) ? 'mute' : 'keep',
    suspiciousThreshold: clampThreshold(source.suspiciousThreshold),
    r9kAction: source.clientR9K === false ? 'keep' :
      source.r9kAction === 'hide' || source.r9kAction === 'mute' ? source.r9kAction :
        source.clientR9K === true && source.r9kAction === undefined ? 'mute' : 'keep',
    enableAuditLog: source.enableAuditLog === true,
    recordSession: source.recordSession === true,
    adjustViewerCounter: source.adjustViewerCounter !== false,
    accountAgeLookup: source.accountAgeLookup !== false,
    showChatStats: source.showChatStats !== false,
    language: normalizeLocale(source.language) || '',
  };

  return settings;
}


/** Compare two normalized settings without depending on object identity. */
export function sameSettings(a: Settings | null | undefined, b: Settings | null | undefined): boolean {
  if (!a || !b) return false;
  return Object.entries(b).every(([key, value]) => Reflect.get(a, key) === value);
}
