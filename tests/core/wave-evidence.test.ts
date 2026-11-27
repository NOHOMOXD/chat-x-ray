import { expect, it } from 'vitest';
import { waveEvidence } from '../../src/core/wave-evidence.ts';

it('requires shared rare phrase speakers or the same order in three distinct waves', () => {
  const wave = [1, 2, 3, 4].map((numericUserId, i) => ({
    numericUserId, userKey: String(numericUserId), waveBoost: true,
    text: i < 2 ? 'одна редкая длинная фраза' : '322',
  }));
  const context = Array.from({ length: 40 }, (_, i) => ({ numericUserId: i + 10, userKey: String(i + 10), text: '322' }));
  const [one, two, three, four] = wave;
  if (!one || !two || !three || !four) throw new Error('Expected four wave records');
  const first = waveEvidence(wave, [], context).wave;
  const next = waveEvidence([one, two, four, three], [first], context);
  expect([...next.repeated]).toEqual([1, 2]);
  expect(next.ordered.size).toBe(0);
  const third = waveEvidence(wave.slice(0, 3), [first, next.wave], context);
  expect([...third.ordered].sort()).toEqual([1, 2, 3]);
  expect(waveEvidence(wave, [first], context.map(r => ({ ...r, text: one.text }))).repeated.size).toBe(0);
});
