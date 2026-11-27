import { describe, expect, it } from 'vitest';
import { decodeBridgeControl } from '../../src/platform/bridge-control.ts';

describe('bridge control events', () => {
  it('leaves ordinary chat messages for the analyzer', () => {
    expect(decodeBridgeControl({ login: 'viewer', text: 'hello' })).toBeNull();
    expect(decodeBridgeControl({ kind: 'future-event' })).toBeNull();
  });

  it('accepts a room update and rejects malformed known events', () => {
    const room = { kind: 'room-state', channel: 'example', socketId: 1, receivedAt: 10, mode: { slow: 5 } };
    expect(decodeBridgeControl(room)).toEqual(room);
    expect(decodeBridgeControl({ ...room, mode: { slow: 'bad' } })).toEqual({ kind: 'invalid' });
    expect(decodeBridgeControl({ kind: 'socket-open', socketId: NaN })).toEqual({ kind: 'invalid' });
  });

  it('retains raid fields for history and session export', () => {
    const raid = { kind: 'raid', channel: 'example', id: '1', ts: 10, viewers: 40, extra: 'context' };
    expect(decodeBridgeControl(raid)).toEqual(raid);
  });
});
