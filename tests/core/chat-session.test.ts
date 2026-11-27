import { expect, it } from 'vitest';
import { ChatSession } from '../../src/core/chat-session.ts';

it('prunes expired prefixes and releases only their message identifiers', () => {
  const session = new ChatSession({ recentWindowMs: 100 });
  session.markSeen('old', 10);
  session.markSeen('recent', 110);
  session.records = [
    { id: 'old', ts: 10, userKey: 'a', botScore: 0 },
    { id: 'recent', ts: 110, userKey: 'b', botScore: 0 },
    { id: 'late', ts: 5, userKey: 'c', botScore: 0 },
  ];

  session.prune(150);

  expect(session.records.map(record => record.id)).toEqual(['recent', 'late']);
  expect(session.markSeen('old', 150)).toBe(true);
  expect(session.markSeen('recent', 150)).toBe(false);
});

it('keeps the same complete record in the session and wave bucket', async () => {
  const { BotWaveTracker } = await import('../../src/core/bot-wave-tracker.ts');
  type Message = { id: string; ts: number; userKey: string; bucketStart: number; unbadged: boolean; text: string };
  const session = new ChatSession<Message>();
  const waves = new BotWaveTracker<Message>();
  const record: Message = { id: '1', ts: 1000, userKey: 'viewer', bucketStart: 0, unbadged: true, text: 'hello' };
  session.getUserState(record.userKey, 'viewer', 'viewer', record.ts);
  session.commit(record, record.text);
  const { bucket } = waves.observe(record);
  expect(session.records[0]).toBe(record);
  expect(bucket.records[0]).toBe(record);
  expect(bucket.records[0]?.text).toBe('hello');
});
