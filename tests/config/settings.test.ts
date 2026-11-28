import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULTS,
  DEFAULT_THRESHOLD,
  STORAGE_KEY,
  SettingsRepository,
  clampThreshold,
  normalizeSettings,
} from '../../src/config/settings.ts';

/** Minimal stand-in for chrome.storage.local with latency control. */
function fakeStorage(initial: Record<string, unknown>, { delay = 0 } = {}) {
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
  it('keeps messages unchanged by default and migrates saved choices', () => {
    expect(normalizeSettings({})).toMatchObject({ suspectAction: 'keep', r9kAction: 'keep', accountAgeLookup: true, recordSession: false });
    expect(normalizeSettings({ clientR9K: false, muteSuspicious: true, r9kAction: 'hide', accountAgeLookup: false, recordSession: true }))
      .toMatchObject({ r9kAction: 'keep', suspectAction: 'mute', accountAgeLookup: false, recordSession: true });
  });

  it('ship a 30% threshold and a visible stats strip', () => {
    const defaults = normalizeSettings(DEFAULTS);
    expect(defaults.suspiciousThreshold).toBe(30);
    expect(DEFAULT_THRESHOLD).toBe(30);
    expect(defaults.showChatStats).toBe(true);
    expect(defaults.showBadges).toBe(true);
    expect(defaults.adjustViewerCounter).toBe(true);
    expect(defaults.language).toBe('');
  });
});

describe('clampThreshold', () => {
  it('accepts presets and resets other values', () => {
    for (const value of [10, 30, 50, 70]) expect(clampThreshold(value)).toBe(value);
    for (const value of [5, 45, 90, 100, 'abc', undefined]) expect(clampThreshold(value)).toBe(30);
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
    expect(settings.suspectAction).toBe('hide');
  });

  it('keeps only supported R9K actions', () => {
    expect(normalizeSettings({ r9kAction: 'hide' }).r9kAction).toBe('hide');
    expect(normalizeSettings({ r9kAction: 'explode' }).r9kAction).toBe('keep');
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
    const storage = fakeStorage({ [STORAGE_KEY]: { suspiciousThreshold: 50 } });
    const repository = new SettingsRepository(storage);
    expect((await repository.load()).suspiciousThreshold).toBe(50);
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
      { [STORAGE_KEY]: { suspiciousThreshold: 70, showBadges: false } },
      { delay: 20 }
    );
    const repository = new SettingsRepository(storage);

    const saving = repository.save({ suspiciousThreshold: 70, showBadges: false });

    await saving;
    expect(storage._data()[STORAGE_KEY]).toMatchObject({ suspiciousThreshold: 70, showBadges: false });
  });

  it('serialises saves so the last write wins', async () => {
    const storage = fakeStorage({});
    const repository = new SettingsRepository(storage);
    await Promise.all([
      repository.save({ suspiciousThreshold: 30 }),
      repository.save({ suspiciousThreshold: 40 }),
      repository.save({ suspiciousThreshold: 50 }),
    ]);
    expect(storage._data()[STORAGE_KEY]).toMatchObject({ suspiciousThreshold: 50 });
  });

  it('is a no-op without a storage area', async () => {
    const repository = new SettingsRepository(null);
    const saved = await repository.save({ suspiciousThreshold: 50 });
    expect(saved.suspiciousThreshold).toBe(50);
  });
});
