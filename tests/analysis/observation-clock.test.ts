import { expect, it } from 'vitest';
import { coveredDuration, ObservationClock } from '../../src/analysis/observation-clock.ts';

it('excludes frozen and unobserved time and merges coverage from multiple tabs', () => {
  const clock = new ObservationClock();
  clock.observe(1000);
  clock.observe(11000);
  clock.pause();
  clock.observe(31000);
  clock.observe(41000);
  clock.observe(141000);
  clock.observe(151000);
  expect(clock.snapshot()).toEqual([[1000, 11000], [31000, 41000], [141000, 151000]]);
  expect(coveredDuration([...clock.snapshot(), [5000, 15000]])).toBe(34000);
});

it('merges old coverage without filling gaps or starting a disconnected clock', () => {
  const clock = new ObservationClock();
  clock.includeCoverage([[1000, 5000], [4000, 9000], [5, 5], null]);
  expect(clock.since).toBe(null);
  clock.observe(30000);
  clock.includeCoverage([[1000, 7000]]);
  clock.observe(31000);
  expect(clock.snapshot()).toEqual([[1000, 9000], [30000, 31000]]);
  expect(coveredDuration(clock.snapshot())).toBe(9000);
});
