import { describe, expect, it, vi } from 'vitest';
import { createBroadcastHistoryClient, HISTORY_MESSAGE } from '../../src/platform/broadcast-history-client.ts';

describe('broadcast history client', () => {
  it('validates and returns the background history response', async () => {
    const data = { checkpoint: null, baseline: null, history: [], clearedAt: 0 };
    const send = vi.fn(async () => ({ ok: true, data }));
    const client = createBroadcastHistoryClient(send);
    const identity = { channel: 'example', id: '1' };
    const settings = { suspiciousThreshold: 30 };
    expect(await client.save(identity, settings, {})).toEqual(data);
    expect(send).toHaveBeenCalledWith({ type: HISTORY_MESSAGE, action: 'save', args: [identity, settings, {}] });
  });

  it('rejects errors and invalid responses without returning partial data', async () => {
    const failed = createBroadcastHistoryClient(async () => ({ ok: false, error: 'storage failed' }));
    await expect(failed.clear()).rejects.toThrow('storage failed');
    const malformed = createBroadcastHistoryClient(async () => ({ ok: true, data: { history: 'bad' } }));
    await expect(malformed.save({ channel: 'example', id: '1' }, { suspiciousThreshold: 30 }, {}))
      .rejects.toThrow('Invalid broadcast history response');
    await expect(malformed.clear()).rejects.toThrow('Invalid history clear response');
    await expect(malformed.saveTab('lease', {})).rejects.toThrow('Invalid tab checkpoint response');
  });

  it('decodes checkpoint fields while preserving valid samples and baseline', async () => {
    const client = createBroadcastHistoryClient(async () => ({ ok: true, data: {
      checkpoint: { events: [null, { kind: 'chat-wave', ts: 100 }], samples: [{ ts: 100, er: 3 }, { ts: 'bad' }] },
      baseline: { er: 2, lastEr: 3, sessions: 5, low: 1, high: 4 }, history: [], clearedAt: 0,
    } }));
    const result = await client.save({ channel: 'example', id: '1' }, { suspiciousThreshold: 30 }, {});
    expect(result.checkpoint?.events).toEqual([{ kind: 'chat-wave', ts: 100 }]);
    expect(result.checkpoint?.samples).toEqual([{ ts: 100, er: 3 }]);
    expect(result.baseline?.er).toBe(2);
  });

  it('decodes valid group observations and ignores damaged parts', async () => {
    const observation = { ts: 100, groups: [{ from: 1, to: 10, memberIds: [1, 2], outsideAuthorCount: 30,
      phrases: [{ fingerprint: 'hash', substantive: true, memberIds: [1, 2], outsideAuthors: 1 }] }] };
    const client = createBroadcastHistoryClient(async () => ({ ok: true, data: {
      checkpoint: null, baseline: null, clearedAt: 0,
      history: [{ channel: 'example', id: '1', startedAt: 10, confirmed: {},
        groupObservations: [observation, null] }],
    } }));
    const result = await client.save({ channel: 'example', id: '2' }, { suspiciousThreshold: 30 }, {});
    expect(result.history[0]?.groupObservations).toEqual([observation]);
  });

});
