import { afterEach, expect, it, vi } from 'vitest';
import { UiUpdateScheduler } from '../../src/app/ui-update-scheduler.ts';

afterEach(() => vi.useRealTimers());

it('coalesces independent updates and cancels them on stop', () => {
  vi.useFakeTimers();
  const bind = vi.fn();
  const stats = vi.fn();
  const updates = new UiUpdateScheduler(bind, stats);
  updates.scheduleBind();
  updates.scheduleBind();
  updates.scheduleStats();
  updates.scheduleStats();
  vi.advanceTimersByTime(80);
  expect(bind).toHaveBeenCalledTimes(1);
  expect(stats).not.toHaveBeenCalled();
  vi.advanceTimersByTime(170);
  expect(stats).toHaveBeenCalledTimes(1);
  updates.scheduleBind();
  updates.scheduleStats();
  updates.stop();
  vi.advanceTimersByTime(250);
  expect(bind).toHaveBeenCalledTimes(1);
  expect(stats).toHaveBeenCalledTimes(1);
  updates.scheduleBind();
  vi.advanceTimersByTime(80);
  expect(bind).toHaveBeenCalledTimes(2);
});
