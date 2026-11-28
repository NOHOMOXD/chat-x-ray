import { afterEach, expect, it, vi } from 'vitest';
import { normalizeSettings } from '../../src/config/settings-model.ts';
import { SettingsModal } from '../../src/ui/settings/settings-panel.ts';
import { findHeaderHost } from '../../src/ui/settings/twitch-settings-host.ts';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('finds a connected chat header', () => {
  const header = document.createElement('div');
  header.className = 'stream-chat-header';
  document.body.appendChild(header);
  expect(findHeaderHost()).toBe(header);
});

it('does not schedule menu probes when the settings panel starts', () => {
  vi.useFakeTimers();
  const modal = new SettingsModal({ getSettings: () => normalizeSettings({}), onCommit: () => {} });
  const gear = document.createElement('button');
  gear.setAttribute('data-a-target', 'chat-settings');
  document.body.appendChild(gear);
  modal.start();
  gear.click();
  expect(vi.getTimerCount()).toBe(0);
  modal.stop();
});
