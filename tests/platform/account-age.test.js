import { expect, it } from 'vitest';
import { AccountAgeService } from '../../src/platform/account-age.js';

it('queues a 25-point profile when confirmed freshness could reach the action threshold', () => {
  const settings = { accountAgeLookup: false, suspiciousThreshold: 30 };
  const service = new AccountAgeService({ getSettings: () => settings, fetchImpl: () => {} });
  try {
    expect(service.maybeLookup('viewer', 25, 10)).toBe(false);
    settings.accountAgeLookup = true;
    expect(service.maybeLookup('viewer', 25)).toBe(false);
    expect(service.maybeLookup('viewer', 25, 10)).toBe(true);
    expect(service.maybeLookup('viewer', 25, 10)).toBe(false);
    expect(service.queue).toEqual(['viewer']);
  } finally {
    service.clearQueue();
  }
});
