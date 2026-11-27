import { expect, it } from 'vitest';
import { scoreMessage } from '../../src/core/score-message.ts';

const ordinary = {
  roleExempt: false,
  hasBadges: false,
  color: '',
  firstMsg: false,
  hasDigitPattern: false,
  clusterPeers: 0,
  freshAccount: false,
  apiAgeDays: undefined,
  rhythm: false,
  sterile: false,
  selfSimilarity: 0,
  solicitation: false,
  spamFlood: false,
};

it('returns the base points and reasons in scoring order', () => {
  const result = scoreMessage({ ...ordinary, firstMsg: true, clusterPeers: 2 });
  expect(result.score).toBe(50);
  expect(result.triggers.map(trigger => trigger.key)).toEqual([
    'no-badges', 'default-color', 'first-msg', 'id-cluster',
  ]);
});

it('exempts privileged roles from all base signals', () => {
  const result = scoreMessage({ ...ordinary, roleExempt: true, solicitation: true, spamFlood: true });
  expect(result).toEqual({ score: 0, triggers: [] });
});
