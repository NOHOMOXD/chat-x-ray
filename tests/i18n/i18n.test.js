import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  MESSAGES,
  SUPPORTED_LOCALES,
  formatPercent,
  getLocale,
  normalizeLocale,
  pluralForm,
  resolveLocale,
  setLocale,
  t,
} from '../../src/i18n/i18n.js';

describe('resolveLocale', () => {
  it('honours an explicit setting over the browser', () => {
    expect(resolveLocale('en', { languages: ['ru-RU'] })).toBe('en');
    expect(resolveLocale('ru', { languages: ['en-US'] })).toBe('ru');
  });

  it('defaults to the browser language', () => {
    expect(resolveLocale('', { languages: ['ru-RU', 'en-US'] })).toBe('ru');
    expect(resolveLocale('', { languages: ['en-GB'] })).toBe('en');
  });

  it('falls back to English for every non-Russian language', () => {
    expect(resolveLocale('', { languages: ['de-DE'] })).toBe('en');
    expect(resolveLocale('', { languages: ['ja'] })).toBe('en');
    expect(resolveLocale('', { languages: [] })).toBe('en');
    expect(resolveLocale('ja', { languages: ['de'] })).toBe('en');
  });
});

describe('normalizeLocale', () => {
  it('accepts only supported language codes', () => {
    expect(normalizeLocale('ru-RU')).toBe('ru');
    expect(normalizeLocale('EN')).toBe('en');
    expect(normalizeLocale('fr')).toBe(null);
    expect(normalizeLocale('')).toBe(null);
  });
});

describe('message catalogue', () => {
  it('defines the same keys in both languages', () => {
    expect(Object.keys(MESSAGES.ru).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    expect(SUPPORTED_LOCALES).toEqual(['ru', 'en']);
  });

  it('uses identical placeholders in both languages', () => {
    const placeholders = (value) =>
      Array.from(String(value).matchAll(/\{(\w+)\}/g))
        .map((match) => match[1])
        .sort();
    for (const key of Object.keys(MESSAGES.ru)) {
      expect(placeholders(MESSAGES.ru[key]), key).toEqual(
        placeholders(MESSAGES.en[key])
      );
    }
  });
});

describe('t()', () => {
  it('interpolates and switches language', () => {
    setLocale('en');
    expect(t('counter.loadingPercent', { percent: 66 })).toBe('Loading… 66%');
    expect(t('counter.loadingPercent', { percent: 66 }, 'ru')).toBe(
      'Загружаю… 66%'
    );
  });

  it('returns the key when a message is missing', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('tracks the active locale', () => {
    setLocale('ru');
    expect(getLocale()).toBe('ru');
    expect(t('counter.loading')).toBe('Загружаю');
    setLocale('en');
    expect(t('counter.loading')).toBe('Loading');
  });
});

describe('formatting helpers', () => {
  it('picks russian plural forms', () => {
    expect(pluralForm('ru', 1)).toBe('one');
    expect(pluralForm('ru', 3)).toBe('few');
    expect(pluralForm('ru', 5)).toBe('many');
    expect(pluralForm('ru', 21)).toBe('one');
  });

  it('uses one/other for english', () => {
    expect(pluralForm('en', 1)).toBe('one');
    expect(pluralForm('en', 2)).toBe('other');
  });

  it('formats percentages per locale', () => {
    expect(formatPercent(1.5, 'ru')).toBe('1,5%');
    expect(formatPercent(1.5, 'en')).toBe('1.5%');
    expect(formatPercent(Number.NaN, 'en')).toBe('—');
  });
});

it('localizes the browser manifest in Russian and English', () => {
  const read = (locale) => JSON.parse(readFileSync(
    `src/_locales/${locale}/messages.json`, 'utf8',
  ));
  const ru = read('ru');
  const en = read('en');
  expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  for (const key of ['extName', 'extDescription']) {
    expect(ru[key].message).toMatch(/[а-я]/i);
    expect(en[key].message).toMatch(/[a-z]/i);
    expect(en[key].message).not.toEqual(ru[key].message);
  }
});
