import { expect, it, vi } from 'vitest';
import { ChatXRayApp } from '../../src/app/app-controller.ts';

it('applies a cached age once per analyzer and again after reset', () => {
  const ages = new Map<string, number>();
  const applyAccountAge = vi.fn((login: string, age: number) => { ages.set(login, age); return false; });
  const host = { started: true, settings: { accountAgeLookup: true }, analyzer: { accountAges: ages, applyAccountAge } };
  const apply = ChatXRayApp.prototype.handleAccountAge.bind(host as unknown as ChatXRayApp);
  apply('writer', 12);
  apply('writer', 12);
  expect(applyAccountAge).toHaveBeenCalledTimes(1);
  ages.clear();
  apply('writer', 12);
  expect(applyAccountAge).toHaveBeenCalledTimes(2);
});
