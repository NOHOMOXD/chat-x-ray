import { afterEach, expect, it, vi } from 'vitest';
import { callStorage } from '../../src/platform/browser-api.ts';

afterEach(() => vi.unstubAllGlobals());

it('accepts callback and promise based storage methods', async () => {
  vi.stubGlobal('chrome', { runtime: {} });
  await expect(callStorage((key: string, done: (value: string) => void) => done(key), 'saved'))
    .resolves.toBe('saved');
  await expect(callStorage((key: string) => Promise.resolve(key), 'saved'))
    .resolves.toBe('saved');
});

it('rejects callback errors exposed by the browser', async () => {
  vi.stubGlobal('chrome', { runtime: { lastError: { message: 'storage failed' } } });
  await expect(callStorage((_key: string, done: (value: string) => void) => done('ignored'), 'key'))
    .rejects.toThrow('storage failed');
});
