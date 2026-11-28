import { afterEach, expect, it, vi } from 'vitest';
import { normalizeSettings } from '../../src/config/settings-model.ts';
import { SettingsModal } from '../../src/ui/settings/settings-panel.ts';
import { findSettingsMenuHost } from '../../src/ui/settings/twitch-settings-host.ts';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('uses a generic dialog only when the chat gear controls it', () => {
  const gear = document.createElement('button');
  gear.setAttribute('data-a-target', 'chat-settings');
  const dialog = document.createElement('div');
  dialog.id = 'dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.getBoundingClientRect = () => ({ width: 200, height: 100 } as DOMRect);
  document.body.append(gear, dialog);
  expect(findSettingsMenuHost()).toBeNull();
  gear.setAttribute('aria-controls', 'dialog');
  expect(findSettingsMenuHost()).toBe(dialog);
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
