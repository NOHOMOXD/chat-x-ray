import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures.ts';

test('restores the same broadcast after a background freeze and tab replacement', async ({ page, context }) => {
  test.setTimeout(55000);
  const storageErrors: string[] = [];
  const begin = async (tab: Page) => {
    tab.on('console', (line) => {
      if (line.text().includes('[Twitch Chat X-Ray] broadcast history')) storageErrors.push(line.text());
    });
    await tab.evaluate(() => {
      const status = document.querySelector<HTMLElement>('.live-channel-metadata-bar');
      if (!status) throw new Error('Missing live metadata');
      status.dataset.channelLogin = 'testchannel';
      status.dataset.streamId = '123450001';
      status.dataset.streamStartedAt = '2025-01-01T00:00:00Z';
      window.__fixture.createChatSocket();
    });
    await tab.locator('[data-tcx-ui="settings-button"]').click();
    await tab.locator('[data-tcx-setting="recordSession"]').check();
  };
  const snapshot = async (tab: Page) => {
    const download = tab.waitForEvent('download');
    await tab.locator('[data-tcx-session-export="0"]').click();
    const path = await (await download).path();
    if (!path) throw new Error('Missing download path');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  await begin(page);
  await page.waitForTimeout(10500);
  const other = await context.newPage();
  await other.bringToFront();
  // Deliver the lifecycle events explicitly. A headless DevTools evaluation
  // can wake a frozen renderer, so it cannot reliably test the OS scheduler.
  await page.evaluate(() => document.dispatchEvent(new Event('freeze')));
  const paused = await snapshot(page);
  await other.waitForTimeout(1200);
  const stillPaused = await snapshot(page);
  expect(stillPaused.observation).toEqual(paused.observation);
  await page.evaluate(() => document.dispatchEvent(new Event('resume')));
  await page.bringToFront();
  await expect.poll(async () => (await snapshot(page)).broadcastEvents.some(
    (event: { reason?: string }) => event.reason === 'freeze',
  )).toBe(true);
  const before = await snapshot(page);
  await page.close({ runBeforeUnload: false });
  await other.route('https://www.twitch.tv/**', (route) => route.fulfill({
    contentType: 'text/html', path: 'tests/e2e/fixtures/chat.html',
  }));
  await other.goto('https://www.twitch.tv/testchannel');
  await begin(other);
  await expect.poll(async () => {
    const after = await snapshot(other);
    return {
      id: after.broadcast?.id,
      restoredFreeze: after.broadcastEvents.some((event: { reason?: string }) => event.reason === 'freeze'),
      createdOutflow: after.broadcastEvents.some((event: { kind?: string }) => event.kind === 'viewer-outflow'),
      storageErrors,
    };
  }).toEqual({ id: before.broadcast.id, restoredFreeze: true, createdOutflow: false, storageErrors: [] });
});
