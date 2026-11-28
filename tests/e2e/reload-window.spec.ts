import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures.ts';

async function connect(page: Page, identify = true) {
  await page.evaluate(async (identifyStream) => {
    const socket = window.__fixture.createChatSocket();
    if (!socket) throw new Error('Missing chat socket');
    const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
    socket.close();
    await closed;
    socket.dispatchEvent(new Event('open'));
    window.roomSocket = socket;
    if (identifyStream) await fetch('https://gql.twitch.tv/gql', { method: 'POST', body: '[{}]' }).then(response => response.json());
  }, identify);
}

async function sendChat(page: Page, prefix: string) {
  await page.evaluate((prefix) => {
    for (let i = 0; i < 7; i++) {
      const user = prefix + i;
      window.__fixture.deliver(window.roomSocket, '@id=' + user + ';user-id=' + (10000 + 2000 * i) +
        ';badges=subscriber/1;tmi-sent-ts=' + Date.now() + ' :' + user + '!x@x PRIVMSG #testchannel :hello ' + i);
    }
  }, prefix);
}

async function prepare(page: Page) {
  await page.route('https://gql.twitch.tv/gql', route => route.fulfill({
    contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify([{ data: { user: { login: 'testchannel', stream: { id: '123450001' } } } }]),
  }));
  await connect(page);
  await sendChat(page, 'first');
  await expect(page.locator('[data-tcx-ui="real-viewers"]')).toContainText('(7)');
}

test('shows a full window after one reload and ten minutes of observation', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Virtual time uses the Chromium DevTools protocol');
  test.setTimeout(60000);
  await prepare(page);
  await page.waitForTimeout(11500);
  await page.reload();
  await connect(page);
  const counter = page.locator('[data-tcx-ui="real-viewers"]');
  await expect(counter).toContainText('(7)');
  const cdp = await page.context().newCDPSession(page);
  const advance = async (milliseconds: number) => {
    const expired = new Promise<void>(resolve => cdp.once('Emulation.virtualTimeBudgetExpired', () => resolve()));
    await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: milliseconds });
    await expired;
  };
  await advance(570000);
  await sendChat(page, 'late');
  await counter.evaluate(element => (element as HTMLElement).focus());
  await advance(1000);
  const tooltip = page.locator('[role="dialog"][data-state="visible"] .tcx-tip--viewer');
  await expect(tooltip).toContainText(/9 из 10|9 of 10/);
  await advance(32000);
  await expect(tooltip).toContainText(/Полное окно наблюдения|Full observation window/);
});

test('preserves the previous coverage through two reloads before stream identification', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Checkpoint inspection uses the Chromium extension service worker');
  test.setTimeout(60000);
  await prepare(page);
  await page.waitForTimeout(11500);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const checkpoint = () => worker.evaluate(async () => {
    const entries = await chrome.storage.session.get(null);
    const entry = Object.entries(entries).find(([key]) => key.startsWith('tcx:reload:v2:') && key.endsWith(':testchannel'));
    const stored = entry?.[1] as { snapshot?: { identity: { id: string }; formula: Array<[number, number]> } } | undefined;
    return stored?.snapshot;
  });
  const before = await checkpoint();
  expect(before?.formula.length).toBeGreaterThan(0);
  await page.reload();
  await connect(page, false);
  await expect(page.locator('[data-tcx-ui="real-viewers"]')).toContainText('(7)');
  await page.waitForTimeout(2200);
  await page.reload();
  await connect(page);
  await page.waitForTimeout(2200);
  const after = await checkpoint();
  expect(after?.identity.id).toBe(before?.identity.id);
  expect(after?.formula[0]?.[0]).toBe(before?.formula[0]?.[0]);
  expect(after?.formula.length).toBeGreaterThanOrEqual(2);
  expect(after!.formula[1]![0]).toBeGreaterThan(after!.formula[0]![1]);
});

for (const route of ['reloads', 'navigation'] as const) {
  test(`restores a full observed window after ${route}`, async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Virtual time uses the Chromium DevTools protocol');
    test.setTimeout(90000);
    await prepare(page);
    await page.locator('[data-tcx-ui="settings-button"]').click();
    await page.locator('[data-tcx-setting="recordSession"]').check();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(11500);
    await page.evaluate(() => {
      history.pushState({}, '', '/otherchannel');
      document.querySelector<HTMLElement>('.live-channel-metadata-bar')!.dataset.channelLogin = 'otherchannel';
    });
    await page.waitForTimeout(2200);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
      const entries = await chrome.storage.session.get(null);
      const key = Object.keys(entries).find(name => name.startsWith('tcx:reload:v2:') && name.endsWith(':testchannel'));
      if (!key) throw new Error('Missing checkpoint');
      const entry = entries[key] as { snapshot: { formula: Array<[number, number]>; chat: Array<[number, number]> } };
      const end = Date.now() - 1000;
      entry.snapshot.formula = [[end - 360000, end]];
      entry.snapshot.chat = [[end - 360000, end]];
      await chrome.storage.session.set({ [key]: entry });
    });
    await page.evaluate(() => {
      history.pushState({}, '', '/testchannel');
      document.querySelector<HTMLElement>('.live-channel-metadata-bar')!.dataset.channelLogin = 'testchannel';
    });
    await connect(page);
    await page.waitForTimeout(2200);
    if (route === 'reloads') {
      await page.reload();
      await connect(page);
    } else {
      await page.evaluate(() => {
        history.pushState({}, '', '/otherchannel');
        document.querySelector<HTMLElement>('.live-channel-metadata-bar')!.dataset.channelLogin = 'otherchannel';
      });
      await page.waitForTimeout(2200);
      await page.evaluate(() => {
        history.pushState({}, '', '/testchannel');
        document.querySelector<HTMLElement>('.live-channel-metadata-bar')!.dataset.channelLogin = 'testchannel';
      });
      await connect(page);
    }
    await sendChat(page, 'after');
    const cdp = await page.context().newCDPSession(page);
    const expired = new Promise<void>(resolve => cdp.once('Emulation.virtualTimeBudgetExpired', () => resolve()));
    await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 245000 });
    await expired;
    const counter = page.locator('[data-tcx-ui="real-viewers"]');
    await counter.evaluate(element => (element as HTMLElement).focus());
    const tooltip = page.locator('[role="dialog"][data-state="visible"] .tcx-tip--viewer');
    await expect(tooltip).toContainText(/Полное окно наблюдения|Full observation window/);
    await page.keyboard.press('Escape');
    await page.locator('[data-tcx-ui="settings-button"]').click();
    const downloading = page.waitForEvent('download');
    await page.locator('[data-tcx-session-export="0"]').click();
    const file = await (await downloading).path();
    if (!file) throw new Error('Missing session export');
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    expect(snapshot.lastViewerModel.sessionMs).toBeGreaterThanOrEqual(600000);
    expect(snapshot.lastViewerModel.engagement.measurable).toBe(true);
  });
}
