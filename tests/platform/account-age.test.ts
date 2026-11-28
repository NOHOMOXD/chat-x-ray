import { expect, it } from 'vitest';
import { AccountAgeService } from '../../src/platform/account-age.ts';

it('queues a 25-point profile when confirmed freshness could reach the action threshold', () => {
  const settings = { accountAgeLookup: false, suspiciousThreshold: 30 };
  const service = new AccountAgeService({ getSettings: () => settings, fetchImpl: async () => new Response() });
  try {
    expect(service.maybeLookup('viewer', 25, 10)).toBe(false);
    settings.accountAgeLookup = true;
    expect(service.maybeLookup('viewer', 25)).toBe(false);
    expect(service.maybeLookup('viewer', 25, 10)).toBe(true);
    expect(service.maybeLookup('viewer', 25, 10)).toBe(false);
    expect(service['queue']).toEqual(['viewer']);
  } finally {
    service.clearQueue();
  }
});

it('reads account creation dates from an optional GQL response', async () => {
  const ages: number[] = [];
  const now = Date.parse('2026-01-11T00:00:00Z');
  const service = new AccountAgeService({
    getSettings: () => ({ accountAgeLookup: true, suspiciousThreshold: 30 }),
    fetchImpl: async () => new Response(JSON.stringify({ data: { u0: { createdAt: '2026-01-01T00:00:00Z' } } })),
    now: () => now,
    onAge: (_login, ageDays) => ages.push(ageDays),
  });
  try {
    expect(service.maybeLookup('viewer', 30)).toBe(true);
    await service.flush();
    expect(ages).toEqual([10]);
  } finally {
    service.clearQueue();
  }
});

it('applies a cached response after lookup is re-enabled', async () => {
  const settings = { accountAgeLookup: true, suspiciousThreshold: 30 };
  const ages: number[] = [];
  let resolveFetch: (response: Response) => void = () => {};
  let requests = 0;
  const service = new AccountAgeService({
    getSettings: () => settings,
    now: () => Date.parse('2026-01-11T00:00:00Z'),
    fetchImpl: () => { requests++; return new Promise<Response>(resolve => { resolveFetch = resolve; }); },
    onAge: (_login, age) => ages.push(age),
  });
  try {
    service.maybeLookup('viewer', 30);
    const pending = service.flush();
    settings.accountAgeLookup = false;
    resolveFetch(new Response(JSON.stringify({ data: { u0: { createdAt: '2026-01-01T00:00:00Z' } } })));
    await pending;
    expect(ages).toEqual([]);
    settings.accountAgeLookup = true;
    expect(service.maybeLookup('viewer', 30)).toBe(false);
    expect(ages).toEqual([10]);
    expect(requests).toBe(1);
  } finally {
    service.clearQueue();
  }
});
