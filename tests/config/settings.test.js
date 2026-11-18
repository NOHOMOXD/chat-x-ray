import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULTS,
  DEFAULT_THRESHOLD,
  STORAGE_KEY,
  SettingsRepository,
  clampThreshold,
  normalizeSettings,
} from '../../src/config/settings.js';

/** Minimal stand-in for chrome.storage.local with latency control. */
function fakeStorage(initial, { delay = 0 } = {}) {
  let data = initial ? { ...initial } : {};
  return {
    get: vi.fn((key, callback) => {
      setTimeout(() => callback({ [key]: data[key] }), delay);
    }),
    set: vi.fn((payload, callback) => {
      setTimeout(() => {
        Object.assign(data, payload);
        callback();
      }, delay);
    }),
    _data: () => data,
  };
}

describe('defaults', () => {
  it('ship a 25% threshold and a visible stats strip', () => {
    const defaults = normalizeSettings(DEFAULTS);
    expect(defaults.suspiciousThreshold).toBe(25);
    expect(DEFAULT_THRESHOLD).toBe(25);
    expect(defaults.showChatStats).toBe(true);
    expect(defaults.showBadges).toBe(true);
    expect(defaults.adjustViewerCounter).toBe(true);
    expect(defaults.language).toBe('');
  });
});

describe('clampThreshold', () => {
  it('clamps to 10..100 and rounds to the 5% step', () => {
    expect(clampThreshold(5)).toBe(10);
    expect(clampThreshold(73)).toBe(75);
    expect(clampThreshold(14)).toBe(15);
    expect(clampThreshold(120)).toBe(100);
    expect(clampThreshold('abc')).toBe(25);
    expect(clampThreshold(undefined)).toBe(25);
  });
});

describe('normalizeSettings', () => {
  it('falls back to defaults for junk input', () => {
    expect(normalizeSettings(null)).toEqual(normalizeSettings(DEFAULTS));
    expect(normalizeSettings('nope')).toEqual(normalizeSettings(DEFAULTS));
  });

  it('lets hide win over mute', () => {
    const settings = normalizeSettings({
      muteSuspicious: true,
      hideSuspicious: true,
    });
    expect(settings.hideSuspicious).toBe(true);
    expect(settings.muteSuspicious).toBe(false);
  });

  it('keeps only supported R9K actions', () => {
    expect(normalizeSettings({ r9kAction: 'hide' }).r9kAction).toBe('hide');
    expect(normalizeSettings({ r9kAction: 'explode' }).r9kAction).toBe('mute');
  });

  it('accepts ru/en and treats anything else as auto', () => {
    expect(normalizeSettings({ language: 'ru' }).language).toBe('ru');
    expect(normalizeSettings({ language: 'RU-ru' }).language).toBe('ru');
    expect(normalizeSettings({ language: 'en' }).language).toBe('en');
    expect(normalizeSettings({ language: 'de' }).language).toBe('');
  });
});

describe('SettingsRepository', () => {
  it('loads stored settings', async () => {
    const storage = fakeStorage({ [STORAGE_KEY]: { suspiciousThreshold: 60 } });
    const repository = new SettingsRepository(storage);
    expect((await repository.load()).suspiciousThreshold).toBe(60);
  });

  it('falls back to defaults when storage is missing or throws', async () => {
    expect((await new SettingsRepository(null).load()).showBadges).toBe(true);
    const broken = {
      get: () => {
        throw new Error('boom');
      },
    };
    expect((await new SettingsRepository(broken).load()).showBadges).toBe(true);
  });

  it('never overwrites stored settings with defaults when saving early', async () => {
    // Regression: a save() issued before load() resolved used to persist the
    // in-memory defaults over the user's real record.
    const storage = fakeStorage(
      { [STORAGE_KEY]: { suspiciousThreshold: 80, showBadges: false } },
      { delay: 20 }
    );
    const repository = new SettingsRepository(storage);

    const saving = repository.save({ suspiciousThreshold: 80, showBadges: false });

    await saving;
    expect(storage._data()[STORAGE_KEY].suspiciousThreshold).toBe(80);
    expect(storage._data()[STORAGE_KEY].showBadges).toBe(false);
  });

  it('serialises saves so the last write wins', async () => {
    const storage = fakeStorage({});
    const repository = new SettingsRepository(storage);
    await Promise.all([
      repository.save({ suspiciousThreshold: 30 }),
      repository.save({ suspiciousThreshold: 40 }),
      repository.save({ suspiciousThreshold: 50 }),
    ]);
    expect(storage._data()[STORAGE_KEY].suspiciousThreshold).toBe(50);
  });

  it('is a no-op without a storage area', async () => {
    const repository = new SettingsRepository(null);
    const saved = await repository.save({ suspiciousThreshold: 35 });
    expect(saved.suspiciousThreshold).toBe(35);
  });
});
