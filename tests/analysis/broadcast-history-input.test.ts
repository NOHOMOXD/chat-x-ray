import { describe, expect, it } from 'vitest';
import { isHistoryUpdate } from '../../src/analysis/broadcast-history-clear.ts';
import { isBroadcastIdentity, isBroadcastProfileSettings } from '../../src/analysis/broadcast-profile.ts';
import { BroadcastHistory, BROADCAST_HISTORY_KEY } from '../../src/analysis/broadcast-history.ts';

describe('broadcast history input', () => {
  it('accepts a valid update and rejects malformed evidence', () => {
    expect(isHistoryUpdate({ samples: [{ ts: 100, er: 2 }], events: [{ kind: 'surge', ts: 100 }] })).toBe(true);
    expect(isHistoryUpdate({ samples: [{ ts: 100, er: '2' }] })).toBe(false);
    expect(isHistoryUpdate({ groups: [{ ts: 100, groups: [{ memberIds: null }] }] })).toBe(false);
    expect(isBroadcastIdentity({ channel: 'example', id: '123' })).toBe(true);
    expect(isBroadcastIdentity({ channel: 'example' })).toBe(false);
    expect(isBroadcastProfileSettings({ suspiciousThreshold: 30, accountAgeLookup: false })).toBe(true);
    expect(isBroadcastProfileSettings({ suspiciousThreshold: '30' })).toBe(false);
  });

  it('reads an older record with a partial checkpoint and skips malformed records', async () => {
    const store = new BroadcastHistory({
      storage: {
        get: async () => ({ [BROADCAST_HISTORY_KEY]: [
          { channel: 'example', id: '1', profiles: { old: [{ ts: 10, er: 1 }] }, checkpoint: { groups: [] } },
          { channel: 'broken', profiles: null, checkpoint: {} },
        ] }),
      },
      locks: null,
    });
    const records = await store.read();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: '1', profiles: { old: [{ ts: 10, er: 1 }] }, checkpoint: { groups: [] } });
  });

  it('keeps valid evidence when part of a checkpoint is damaged', async () => {
    const store = new BroadcastHistory({
      storage: {
        get: async () => ({ [BROADCAST_HISTORY_KEY]: [{
          channel: 'example', id: '1', profiles: { profile: [{ ts: 10, er: 1 }] },
          checkpoint: {
            intervals: { chat: [[1, 5]], viewer: 'damaged' },
            events: [null, { kind: 'surge', ts: 20 }, { kind: 'churn', ts: 'bad' }],
            groups: [null, { ts: 30, groups: [{ memberIds: [1, 2] }] }],
          },
        }] }),
      },
      locks: null,
    });
    const records = await store.read();
    expect(records).toHaveLength(1);
    expect(records[0]?.checkpoint).toMatchObject({
      intervals: { chat: [[1, 5]], viewer: [] },
      events: [{ kind: 'surge', ts: 20 }],
      groups: [{ ts: 30, groups: [{ memberIds: [1, 2] }] }],
    });
  });

});
