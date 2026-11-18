import { describe, expect, it } from 'vitest';

import {
  Analyzer,
  DEFAULTS,
  PRIVILEGED_BADGES,
  SERVICE_BOT_LOGINS,
  WEIGHTS,
  badgesArray,
  parseNumericId,
} from '../../src/core/analyzer.js';

let seq = 0;

/** A plain, healthy chatter: badged, coloured, no bot signals. */
function message(overrides = {}) {
  seq += 1;
  return {
    id: `msg-${seq}`,
    userId: String(100000 + seq),
    login: `user${seq}`,
    displayName: `User ${seq}`,
    badges: ['subscriber'],
    color: '#FF0000',
    firstMsg: false,
    ts: 1_000_000 + seq * 1000,
    text: `message number ${seq}`,
    channel: 'testchannel',
    ...overrides,
  };
}

function score(overrides, options) {
  const analyzer = new Analyzer(options);
  const msg = message(overrides);
  const result = analyzer.ingest(msg, msg.ts);
  return result.record;
}

describe('weights matrix', () => {
  it('sums to exactly 100', () => {
    const total = Object.values(WEIGHTS).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(100);
  });
});

describe('helpers', () => {
  it('badgesArray lowercases and deduplicates', () => {
    expect(badgesArray(['Moderator', 'moderator', 'VIP'])).toEqual([
      'moderator',
      'vip',
    ]);
    expect(badgesArray(null)).toEqual([]);
  });

  it('parseNumericId accepts safe ids only', () => {
    expect(parseNumericId('123')).toBe(123);
    expect(parseNumericId(456)).toBe(456);
    expect(parseNumericId('12a')).toBe(null);
    expect(parseNumericId(-1)).toBe(null);
    expect(parseNumericId('12345678901234567')).toBe(null);
  });

  it('knows the privileged badges and service bots', () => {
    expect(PRIVILEGED_BADGES.moderator).toBe(true);
    expect(SERVICE_BOT_LOGINS.nightbot).toBe(true);
  });
});

describe('scoring', () => {
  it('gives a healthy chatter a low score', () => {
    const record = score({});
    expect(record.botScore).toBe(0);
    expect(record.triggers).toEqual([]);
  });

  it('no badges + default colour = exactly the 25% default threshold', () => {
    const record = score({ badges: [], color: '' });
    expect(record.botScore).toBe(25);
    expect(record.botScore).toBe(DEFAULTS.suspiciousThreshold);
    expect(record.triggers.map((t) => t.key)).toEqual([
      'no-badges',
      'default-color',
    ]);
  });

  it('adds points for a numeric nickname suffix', () => {
    const record = score({ login: 'streamer_4892', badges: [], color: '' });
    expect(record.botScore).toBe(35);
    expect(record.triggers.some((t) => t.key === 'username-digits')).toBe(true);
  });

  it('adds points for a first message', () => {
    const record = score({ firstMsg: true, badges: [], color: '' });
    expect(record.botScore).toBe(35);
    expect(record.triggers.some((t) => t.key === 'first-msg')).toBe(true);
  });

  it('exempts moderators, VIPs, subscribers and the broadcaster', () => {
    for (const badge of ['moderator', 'vip', 'subscriber', 'broadcaster']) {
      const record = score({ badges: [badge], color: '' });
      expect(record.roleExempt).toBe(true);
      expect(record.botScore).toBe(0);
    }
  });

  it('exempts known service bots', () => {
    const record = score({ login: 'nightbot', badges: [], color: '' });
    expect(record.serviceBot).toBe(true);
    expect(record.roleExempt).toBe(true);
    expect(record.botScore).toBe(0);
  });

  it('flags a cluster of empty accounts with close user ids', () => {
    const analyzer = new Analyzer();
    const base = 900000;
    for (let i = 0; i < 2; i += 1) {
      analyzer.ingest(
        message({ userId: String(base + i * 1000), login: `empty${i}`, badges: [], color: '' }),
        1_000_000
      );
    }
    const target = message({
      userId: String(base + 2000),
      login: 'target',
      badges: [],
      color: '',
    });
    const record = analyzer.ingest(target, target.ts).record;
    expect(record.triggers.some((t) => t.key === 'id-cluster')).toBe(true);
    expect(record.botScore).toBe(40);
  });

  it('does not cluster ids 50 000 apart', () => {
    const analyzer = new Analyzer();
    analyzer.ingest(
      message({ userId: '900000', login: 'far_a', badges: [], color: '' }),
      1_000_000
    );
    analyzer.ingest(
      message({ userId: '1000000', login: 'far_b', badges: [], color: '' }),
      1_000_000
    );
    const target = message({
      userId: '950000',
      login: 'far_target',
      badges: [],
      color: '',
    });
    const record = analyzer.ingest(target, target.ts).record;
    expect(record.triggers.some((t) => t.key === 'id-cluster')).toBe(false);
  });

  it('flags a fresh empty account by user id', () => {
    const record = score({
      userId: '1500000000',
      login: 'freshone',
      badges: [],
      color: '',
    });
    expect(record.freshAccount).toBe(true);
    expect(record.triggers.some((t) => t.key === 'fresh-account')).toBe(true);
  });

  it('adds a hard bonus for scam content', () => {
    const record = score({ text: 'free nitro for everyone', badges: [], color: '' });
    expect(record.solicitation).toBe(true);
    expect(record.triggers.some((t) => t.key === 'solicitation')).toBe(true);
    // no-badges 15 + default-color 10 + hard signal 25
    expect(record.botScore).toBe(50);
  });

  it('never exceeds 100', () => {
    const record = score({
      login: 'alex8921',
      badges: [],
      color: '',
      firstMsg: true,
      text: 'free nitro dm me paypal',
    });
    expect(record.botScore).toBeLessThanOrEqual(100);
    expect(record.botScore).toBeGreaterThanOrEqual(0);
  });

  it('gives every trigger an i18n key', () => {
    const record = score({
      login: 'x4892',
      badges: [],
      color: '',
      firstMsg: true,
      text: 'free nitro',
    });
    for (const trigger of record.triggers) {
      expect(typeof trigger.labelKey).toBe('string');
    }
  });
});

describe('R9K duplicate detection', () => {
  it('flags a repeat of a recent message', () => {
    const analyzer = new Analyzer();
    const first = analyzer.ingest(
      message({ text: 'hello world', ts: 1_000_000, login: 'alpha', userId: '1' }),
      1_000_000
    ).record;
    const dup = analyzer.ingest(
      message({ text: 'hello world!', ts: 1_005_000, login: 'beta', userId: '2' }),
      1_005_000
    ).record;
    expect(dup.isR9KDuplicate).toBe(true);
    expect(dup.r9kMatchId).toBe(first.id);
  });

  it('ignores messages shorter than the minimum length', () => {
    const analyzer = new Analyzer();
    analyzer.ingest(message({ text: 'ok', ts: 1_000_000 }), 1_000_000);
    const record = analyzer.ingest(message({ text: 'ok', ts: 1_001_000 }), 1_001_000)
      .record;
    expect(record.isR9KDuplicate).toBe(false);
  });

  it('does not treat normal conversation as duplicates', () => {
    const analyzer = new Analyzer();
    analyzer.ingest(message({ text: 'nice play there', ts: 1_000_000 }), 1_000_000);
    const record = analyzer.ingest(
      message({ text: 'totally different words', ts: 1_001_000 }),
      1_001_000
    ).record;
    expect(record.isR9KDuplicate).toBe(false);
  });
});

describe('deduplication', () => {
  it('ignores the same message id delivered twice', () => {
    const analyzer = new Analyzer();
    const msg = message({ id: 'same-id' });
    const first = analyzer.ingest(msg, msg.ts);
    const second = analyzer.ingest(msg, msg.ts);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });
});

describe('reset', () => {
  it('clears all session state', () => {
    const analyzer = new Analyzer();
    analyzer.ingest(message({}), 1_000_000);
    expect(analyzer.getStats(1_001_000).windowMessages).toBe(1);
    analyzer.reset();
    expect(analyzer.getStats(1_001_000).windowMessages).toBe(0);
    expect(analyzer.totalMessages).toBe(0);
  });
});

describe('getStats', () => {
  it('reports wave flag, window size and session length', () => {
    const analyzer = new Analyzer();
    const msg = message({ ts: 1_000_000 });
    analyzer.ingest(msg, 1_000_000);

    // Session length is measured from the message timestamps, not the ingest
    // clock, so an older IRC frame cannot stretch the observation window.
    const stats = analyzer.getStats(1_060_000);
    expect(stats.sessionMs).toBe(60_000);
    expect(stats.isBotWave).toBe(false);
    expect(stats.windowSize).toBe(1);
  });
});
