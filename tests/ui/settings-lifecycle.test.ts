import { afterEach, expect, it, vi } from 'vitest';
import { normalizeSettings } from '../../src/config/settings-model.ts';
import { SettingsModal } from '../../src/ui/settings/settings-panel.ts';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('cancels scheduled menu probes when the settings panel stops', () => {
  vi.useFakeTimers();
  const modal = new SettingsModal({ getSettings: () => normalizeSettings({}), onCommit: () => {} });
  const gear = document.createElement('button');
  gear.setAttribute('data-a-target', 'chat-settings');
  document.body.appendChild(gear);
  modal.start();
  gear.click();
  expect(vi.getTimerCount()).toBe(3);
  modal.stop();
  expect(vi.getTimerCount()).toBe(0);
});
