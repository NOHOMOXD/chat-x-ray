import { afterEach, expect, it, vi } from 'vitest';
import { PageLifecycle } from '../../src/app/page-lifecycle.ts';

afterEach(() => vi.useRealTimers());

it('owns subscriptions and timers across repeated start and stop', () => {
  vi.useFakeTimers();
  const navigate = vi.fn();
  const maintain = vi.fn();
  const freeze = vi.fn();
  const resume = vi.fn();
  const pageHide = vi.fn();
  const hidden = vi.fn();
  const lifecycle = new PageLifecycle({ navigate, maintain, freeze, resume, pageHide, hidden });

  lifecycle.start();
  lifecycle.start();
  window.dispatchEvent(new Event('popstate'));
  document.dispatchEvent(new Event('freeze'));
  window.dispatchEvent(new Event('pagehide'));
  window.dispatchEvent(new Event('pageshow'));
  vi.advanceTimersByTime(1000);
  expect(navigate).toHaveBeenCalledTimes(5);
  expect(maintain).toHaveBeenCalledTimes(1);
  expect(freeze).toHaveBeenCalledTimes(1);
  expect(pageHide).toHaveBeenCalledTimes(1);
  expect(resume).toHaveBeenCalledTimes(1);

  lifecycle.stop();
  window.dispatchEvent(new Event('popstate'));
  vi.advanceTimersByTime(1000);
  expect(navigate).toHaveBeenCalledTimes(5);
  expect(maintain).toHaveBeenCalledTimes(1);
});
