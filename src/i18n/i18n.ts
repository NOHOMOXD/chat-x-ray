import { messagesEn } from './messages-en.ts';
import { messagesRu } from './messages-ru.ts';
/*
 * Twitch Chat X-Ray — tiny dependency-free i18n layer.
 *
 * Two locales are shipped: Russian and English. The language is resolved from
 * the saved setting, otherwise from the browser language, and any language
 * other than Russian falls back to English.
 *
 * Messages are plain templates with {placeholder} slots. The catalogue is
 * never mutated at runtime, so the same key always resolves to the same text
 * for a given locale.
 */
type Locale = 'ru' | 'en';

export const SUPPORTED_LOCALES = Object.freeze(['ru', 'en']);
export const DEFAULT_LOCALE = 'en';

export function normalizeLocale(value: unknown): Locale | null {
  const raw = String(value || '').toLowerCase();
  if (!raw) {
    return null;
  }
  const base = raw.split(/[-_]/)[0];
  return base === 'ru' || base === 'en' ? base : null;
}

/**
 * Resolve the UI language: an explicit setting wins, then the host page's own
 * language (`<html lang>` on Twitch, which follows the Twitch UI language
 * rather than the browser), then the browser languages, and everything that is
 * not Russian becomes English.
 */
export function resolveLocale(explicit: unknown, options?: { htmlLang?: unknown; languages?: readonly string[]; language?: string }): Locale {
  const opts = options || {};
  const fromSetting = normalizeLocale(explicit);
  if (fromSetting) {
    return fromSetting;
  }

  // "Auto" means "the language I read Twitch in", so the page wins over the
  // browser. An unsupported page language falls through to the browser.
  const fromPage = normalizeLocale(opts.htmlLang);
  if (fromPage) {
    return fromPage;
  }

  const candidates: unknown[] = [];
  if (Array.isArray(opts.languages)) {
    for (let i = 0; i < opts.languages.length; i += 1) {
      candidates.push(opts.languages[i]);
    }
  }
  if (opts.language) {
    candidates.push(opts.language);
  }

  if (!candidates.length) {
    try {
      if (typeof navigator !== 'undefined') {
        if (Array.isArray(navigator.languages)) {
          candidates.push(...navigator.languages);
        }
        if (navigator.language) {
          candidates.push(navigator.language);
        }
      }
      if (
        typeof document !== 'undefined' &&
        document.documentElement &&
        document.documentElement.lang
      ) {
        candidates.push(document.documentElement.lang);
      }
    } catch (_error) {
      // Non-browser environment: fall through to the default locale.
    }
  }

  for (let i = 0; i < candidates.length; i += 1) {
    const locale = normalizeLocale(candidates[i]);
    if (locale === 'ru') {
      return 'ru';
    }
  }
  return DEFAULT_LOCALE;
}

/** BCP-47 tag used by Intl formatters for a UI language. */
export function intlLocale(locale: unknown) {
  return normalizeLocale(locale) === 'ru' ? 'ru-RU' : 'en-US';
}

/**
 * Plural form selector for the two shipped languages. English only needs
 * one/other, Russian keeps the three-form rules, but every message can also
 * be written without a plural slot.
 */
export function pluralForm(locale: unknown, count: unknown) {
  const n = Math.abs(Number(count) || 0);
  if (normalizeLocale(locale) !== 'ru') {
    return n === 1 ? 'one' : 'other';
  }
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 > 10 && mod100 < 20) {
    return 'many';
  }
  if (mod10 > 1 && mod10 < 5) {
    return 'few';
  }
  if (mod10 === 1) {
    return 'one';
  }
  return 'many';
}

export const MESSAGES = Object.freeze({ ru: messagesRu, en: messagesEn });


function templateCache(locale: Locale): Record<string, string> {
  return MESSAGES[locale] || MESSAGES[DEFAULT_LOCALE];
}

function interpolate(template: string, params?: Record<string, unknown> | null) {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value === undefined || value === null ? match : String(value);
  });
}

let currentLocale = resolveLocale(null);

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale: unknown) {
  const next = resolveLocale(locale);
  const changed = next !== currentLocale;
  currentLocale = next;
  return changed;
}

/**
 * Translate a key with optional {placeholder} params. Unknown keys return the
 * key itself so a missing string is visible in development instead of
 * silently rendering an empty node.
 */
export function t(key: string, params?: Record<string, unknown> | null, locale?: unknown) {
  const resolved = normalizeLocale(locale) || currentLocale;
  const table = templateCache(resolved);
  let template: string | undefined = table[key];
  if (template === undefined) {
    template = templateCache(DEFAULT_LOCALE)[key];
  }
  if (template === undefined) {
    return String(key);
  }
  return interpolate(template, params);
}

/** Format a locale-aware number for display. */
export function formatLocalizedNumber(value: unknown, locale?: unknown, options?: Intl.NumberFormatOptions) {
  const resolved = normalizeLocale(locale) || currentLocale;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0';
  }
  try {
    return new Intl.NumberFormat(intlLocale(resolved), options || {}).format(
      number
    );
  } catch (_error) {
    return String(Math.round(number));
  }
}

/** Format a percent with a fixed number of fraction digits. */
export function formatPercent(value: unknown, locale?: unknown, digits?: number) {
  const places = typeof digits === 'number' && Number.isFinite(digits) ? digits : 1;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '—';
  }
  const formatted = formatLocalizedNumber(number, locale, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  return formatted + '%';
}

export function chatModeLabel(model: { chatAccess: string; roomMode?: { slow?: number; emotes?: number; unique?: number } }) {
  const labels = [];
  if (['followers', 'subscribers'].includes(model.chatAccess)) labels.push(t('tip.status.' + model.chatAccess));
  if ((model.roomMode?.slow ?? 0) > 0) labels.push(t('room.slow', { seconds: model.roomMode?.slow }));
  if (model.roomMode?.emotes) labels.push(t('room.emotes'));
  if (model.roomMode?.unique) labels.push(t('room.unique'));

  return labels.join(' · ');
}
