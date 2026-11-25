import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures.js';

/**
 * These tests run the shipped build inside a real browser against a local
 * Twitch-shaped fixture (routed at https://www.twitch.tv/, never the live site).
 * They prove the extension actually activates, not just that it compiles.
 */

const CHANNEL = 'testchannel';

/** One well-formed IRCv3 PRIVMSG frame, as Twitch's socket delivers it. */
function privmsg({ id, login, userId, text, badges = '', firstMsg = 0 }) {
  return (
    `@badge-info=;badges=${badges};color=;display-name=${login};` +
    `first-msg=${firstMsg};id=${id};mod=0;room-id=1;tmi-sent-ts=${Date.now()};` +
    `user-id=${userId};user-type= :${login}!${login}@${login}.tmi.twitch.tv ` +
    `PRIVMSG #${CHANNEL} :${text}`
  );
}

test.describe.configure({ mode: 'serial' });

async function writeOnce(page, channel = 'testchannel') {
  const frame = privmsg({ id: 'first', login: 'writer', userId: '103', text: 'hello' }).replace('#testchannel', '#' + channel);
  await page.evaluate(line => window.__fixture.deliver(window.__fixture.createChatSocket(), line), frame);
}

test('the MAIN-world WebSocket tap is installed', async ({ page }) => {
  const wrapped = await page.evaluate(() =>
    Boolean(window.WebSocket.__twitchXRayWrapped)
  );
  expect(wrapped).toBe(true);
});

test('the UI mounts: stats strip, viewer counter and settings button', async ({
  page,
}) => {
  await expect(page.locator('[data-tcx-ui="stats"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-tcx-ui="real-viewers"]')).toHaveCount(0);
  await expect(page.locator('[data-tcx-ui="settings-button"]')).toBeVisible();
});

test('the viewer counter omits unknown room settings', async ({
  page,
}) => {
  const text = page.locator('[data-tcx-ui="real-viewers"]');
  await writeOnce(page);
  await expect(text).toHaveText(/1 чаттер/, { timeout: 15000 });
  await text.hover();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).not.toContainText('Режим чата неизвестен');
});

test('an IRC message is ingested and reflected in the live stats', async ({
  page,
}) => {
  // Everything the tests can see lives in the page's MAIN world; the content
  // script runs isolated. So ingestion is asserted through what it publishes:
  // the "messages in window" counter inside the stats tooltip model.
  const before = await page.evaluate(() => {
    const node = document.querySelector('[data-tcx-ui="stats"]');
    return node ? node.textContent : '';
  });

  const delivered = await page.evaluate(
    ({ frame }) => {
      const socket = window.__fixture.createChatSocket();
      return window.__fixture.deliver(socket, frame);
    },
    {
      frame: privmsg({
        id: 'e2e-1',
        login: 'spambot4892',
        userId: '1500000001',
        text: 'hello everyone',
        firstMsg: 1,
      }),
    }
  );
  expect(delivered).toBe(true);

  // The stats strip polls every second; the messages-per-minute metric must
  // pick the message up.
  await expect
    .poll(
      async () => {
        const text = await page.evaluate(() => {
          const node = document.querySelector('[data-tcx-ui="stats"]');
          return node ? node.textContent : '';
        });
        const match = text.match(/(\d+)\s*сообщ|(\d+)\s*msg/i);
        return match ? Number(match[1] || match[2]) : 0;
      },
      { timeout: 20000 }
    )
    .toBeGreaterThan(0);
});

test('settings open from the chat header button and close on Escape', async ({
  page,
}) => {
  const button = page.locator('[data-tcx-ui="settings-button"]');
  await button.click();

  const dialog = page.locator('[data-tcx-ui="settings-modal"] .tcx-modal__dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-tcx-ui="settings-modal"]')).toHaveCount(0);
});

test('a forged message without the bridge token is ignored', async ({ page }) => {
  // Wait until the tap is live and has adopted the handshake token.
  await expect
    .poll(
      async () =>
        page.evaluate(() => Boolean(window.WebSocket.__twitchXRayWrapped)),
      { timeout: 15000 }
    )
    .toBe(true);

  const readMpm = () =>
    page.evaluate(() => {
      const node = document.querySelector('[data-tcx-ui="stats"]');
      if (!node) return -1;
      const match = node.textContent.match(/(\d+)\s*(сообщ|msg)/i);
      return match ? Number(match[1]) : -1;
    });

  // Let the strip settle first, so the baseline is a real number.
  await expect.poll(readMpm, { timeout: 15000 }).toBeGreaterThanOrEqual(0);
  const before = await readMpm();

  // An attacker page script has no token: it can dispatch any event it likes.
  await page.evaluate(() => {
    const forged = {
      source: 'twitch-chat-xray',
      type: 'privmsg',
      messages: [
        {
          id: 'forged-1',
          login: 'innocent_viewer',
          displayName: 'innocent_viewer',
          text: 'buy followers here',
          badges: [],
          userId: '12345',
          ts: Date.now(),
          channel: 'testchannel',
        },
      ],
    };
    window.dispatchEvent(
      new CustomEvent('twitch-chat-xray:privmsg', { detail: JSON.stringify(forged) })
    );
    window.postMessage(forged, window.location.origin);
  });

  // Give the 1 s maintenance loop two full ticks to (not) pick it up.
  await page.waitForTimeout(2500);
  expect(await readMpm()).toBe(before);
});

test('downloads a session snapshot with regular chat messages', async ({ page }) => {
  await page.locator('[data-tcx-ui="settings-button"]').click();
  await page.locator('[data-tcx-setting="recordSession"]').check();
  const exportButton = page.locator('[data-tcx-session-export="0"]');
  await expect(exportButton).toBeEnabled();
  await page.evaluate(({ frame }) => {
    const socket = window.__fixture.createChatSocket();
    window.__fixture.deliver(socket, frame);
  }, { frame: privmsg({
    id: 'snapshot-regular', login: 'regular', userId: '12345',
    badges: 'subscriber/1', text: 'hello there',
  }) });
  await expect.poll(async () => {
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    const snapshot = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(snapshot).toMatchObject({
      schemaVersion: 3, channel: CHANNEL,
      current: { idGroupAudit: { groups: [], comparison: { threshold: 30 } } },
    });
    return snapshot.current.messages.map((message) => message.id);
  }).toContain('snapshot-regular');
});

test('the viewer popover retains scroll and focus while its online count updates', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addStyleTag({ content: '.tcx-tip--viewer { max-height: 40px !important; }' });
  await page.evaluate((frame) => {
    window.__fixture.deliver(window.__fixture.createChatSocket(), frame);
  }, privmsg({ id: 'scroll-check', login: 'viewer', userId: '102', text: 'Hello' }));
  const trigger = page.locator('[data-tcx-ui="real-viewers"]');
  await trigger.focus();
  const dialog = page.getByRole('dialog');
  const panel = dialog.locator('.tcx-tip--viewer');
  await expect(panel).toBeVisible();
  await expect(panel).not.toContainText('Режим чата неизвестен');
  await expect(panel).toContainText('Чаттерсов за время наблюдения1');
  await expect(panel).toContainText('Сообщений за окно1');
  await expect(panel.locator('details')).toHaveCount(0);
  await trigger.press('ArrowDown');
  await expect(panel).toBeFocused();
  await panel.evaluate((node) => node.scrollTop = 25);
  await expect.poll(() => panel.evaluate((node) => node.scrollTop)).toBe(25);
  await page.locator('[data-a-target="animated-channel-viewers-count"]').evaluate((node) => {
    node.textContent = '123,456';
  });
  await expect(panel).toContainText(/123\s456/);
  await expect(panel).toBeFocused();
  expect(await panel.evaluate((node) => node.scrollTop)).toBe(25);
  await panel.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('chat details retain focus, open state and tab-scoped memory', async ({ page }) => {
  const trigger = page.locator('[data-tcx-ui="stats"]');
  await trigger.focus();
  const dialog = page.getByRole('dialog');
  const details = dialog.locator('details');
  const summary = details.locator('summary');
  await expect(dialog.locator('.tcx-tip--summary > .tcx-tip__list')).toContainText('Чат за минуту');
  await expect(dialog.locator('.tcx-tip--summary > .tcx-tip__list')).toContainText('Записей в аудите');
  await trigger.press('ArrowDown');
  await expect(summary).toBeFocused();
  await summary.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await page.waitForTimeout(1200);
  await expect(summary).toBeFocused();
  await summary.press('Escape');
  await expect(dialog).toBeHidden();
  await trigger.evaluate((node) => node.remove());
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await expect(details).toHaveAttribute('open', '');
});

test('both popovers fit in English with a six-digit online count and less layout space', async ({ page }) => {
  const fixture = await readFile(new URL('./fixtures/chat.html', import.meta.url), 'utf8');
  await page.route('https://www.twitch.tv/testchannel', (route) => route.fulfill({
    contentType: 'text/html',
    body: fixture.replace('lang="ru"', 'lang="en"').replace('73,069', '123,456'),
  }));
  await page.reload();
  await writeOnce(page);
  // A 360px viewport at 150% browser zoom has 240 CSS pixels of layout space.
  for (const width of [360, 240]) {
    await page.setViewportSize({ width, height: 720 });
    for (const id of ['real-viewers', 'stats']) {
      const trigger = page.locator('[data-tcx-ui="' + id + '"]');
      await trigger.focus();
      const dialog = page.getByRole('dialog');
      if (id === 'real-viewers') {
        await expect(dialog).toContainText('123,456');
        await expect(dialog.locator('summary')).toHaveCount(0);
        const widths = await dialog.locator('.tcx-tip--viewer').evaluate((panel) => {
          const probe = document.createElement('div');
          probe.className = 'tcx-tip__hero-value tcx-tip__hero-value--range';
          panel.appendChild(probe);
          const widths = ['3,600 – 11,000', '120,000 – 180,000'].map((text) => {
            probe.textContent = text;
            const range = document.createRange();
            range.selectNodeContents(probe);
            return {
              rows: range.getClientRects().length,
              fits: range.getBoundingClientRect().width <= probe.clientWidth,
            };
          });
          probe.remove();
          return widths;
        });
        expect(widths).toEqual([{ rows: 1, fits: true }, { rows: 1, fits: true }]);
      } else {
        await expect(dialog.locator('summary')).toHaveText('Details');
      }
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await trigger.press('Escape');
      await expect(dialog).toBeHidden();
    }
  }
});

test('shows and exports a confirmed viewer drop while waiting for recovery', async ({ page }) => {
  test.setTimeout(75000);
  await page.locator('[data-tcx-ui="settings-button"]').click();
  await page.locator('[data-tcx-setting="recordSession"]').check();
  const exportButton = page.locator('[data-tcx-session-export="0"]');
  await expect(exportButton).toBeEnabled();
  await page.keyboard.press('Escape');

  const trigger = page.locator('[data-tcx-ui="real-viewers"]');
  const panel = page.getByRole('dialog').locator('.tcx-tip--viewer');
  await expect(trigger).toHaveCount(0);
  // Leave the fixture's initial count in place through the viewer warm-up.
  await page.waitForTimeout(28000);
  await page.locator('[data-a-target="animated-channel-viewers-count"]').evaluate((node) => {
    node.textContent = '58,000';
  });
  await expect(trigger).toContainText('Отток', { timeout: 24000 });
  await trigger.focus();
  await expect(panel).toContainText('Отток');
  await expect(panel).toContainText(/73\s069 → 58\s000/);
  await expect(panel).toContainText('Ожидаем восстановления');
  await trigger.press('Escape');

  await page.locator('[data-tcx-ui="settings-button"]').click();
  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;
  const snapshot = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(snapshot.events.filter((event) => event.kind === 'viewer-outflow')).toMatchObject([
    { from: 73069, to: 58000, delta: -15069, status: 'observing' },
  ]);
});

test('reattaches the current room status after channel switches and viewer node replacement', async ({ page }) => {
  test.setTimeout(45000);
  const viewer = '[data-a-target="animated-channel-viewers-count"]';
  const progress = page.locator(viewer + ' + [data-tcx-ui="real-viewers"][data-tcx-state="activity"]');


  await writeOnce(page);
  await expect(progress).toHaveText(/1 чаттер/);
  const switchTo = (channel) => page.evaluate((name) => {
    history.pushState({}, '', '/' + name);
    document.querySelector('.live-channel-metadata-bar').dataset.channelLogin = name;
  }, channel);
  await switchTo('secondchannel');
  await expect(progress).toHaveCount(0);
  await switchTo('thirdchannel');
  await writeOnce(page, 'thirdchannel');
  await expect(progress).toHaveText(/1 чаттер/, { timeout: 15000 });


  await page.locator(viewer).evaluate((node) => node.replaceWith(node.cloneNode(true)));
  await expect(progress).toHaveText(/1 чаттер/);
});

test('tracks chat restrictions, retains the estimate and keeps a newcomer in the audience', async ({ page }) => {
  test.setTimeout(165000);
  // Drive the real tap on a closed native socket with deterministic local events.
  await page.evaluate(async () => {
    const socket = window.__fixture.createChatSocket();
    const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
    socket.close();
    await closed;
    window.roomSocket = socket;
    socket.dispatchEvent(new Event('open'));
  });
  const send = frame => page.evaluate(line => window.__fixture.deliver(window.roomSocket, line), frame);
  await page.locator('[data-tcx-ui="settings-button"]').click();
  await page.locator('[data-tcx-setting="recordSession"]').check();
  const exportButton = page.locator('[data-tcx-session-export="0"]');
  await expect(exportButton).toBeEnabled();
  await page.keyboard.press('Escape');
  const mode = tags => send('@' + tags + ' :tmi.twitch.tv ROOMSTATE #testchannel');
  const counter = page.locator('[data-tcx-ui="real-viewers"]');
  await mode('subs-only=1;followers-only=-1;slow=0;emote-only=0');
  await expect(counter).toHaveCount(0);
  await send(privmsg({ id: 'new1', login: 'newcomer', userId: '8001', text: 'привет', firstMsg: 1 }));
  await page.evaluate(() => window.__fixture.appendRow('newcomer', 'привет'));
  const row = page.locator('[data-a-user="newcomer"]');
  await expect(row).toHaveAttribute('data-tcx-bound', '1');
  await expect(row.locator('.tcx-bot-badge')).toHaveText('35?');
  await expect(row).toBeVisible();
  await counter.focus();
  await expect(page.locator('[role="dialog"][data-state="visible"]')).toContainText('Чаттерсов за время наблюдения1');
  await counter.press('Escape');
  const strip = page.locator('[data-tcx-ui="stats"]');
  await strip.focus();
  await expect(page.locator('[role="dialog"][data-state="visible"]')).toContainText('1 из 1 сообщений (100%)');
  await strip.press('Escape');
  await page.locator('[data-tcx-ui="settings-button"]').click();
  const downloading = page.waitForEvent('download');
  await exportButton.click();
  const snapshot = JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
  expect(snapshot.current.messages.find(message => message.id === 'new1')).toMatchObject({
    botScore: 35, suspicious: false,
  });
  expect(snapshot.current.stats).toMatchObject({ cleanUsers: 1, chatAccess: 'subscribers' });
  await page.keyboard.press('Escape');
  await mode('slow=5');
  await expect(counter).toHaveText(/1 чаттер/);
  await counter.hover();
  const popover = page.locator('[role="dialog"][data-state="visible"] .tcx-tip--viewer');
  await expect(popover).toContainText('Только для платных подписчиков · Замедление');
  await mode('subs-only=0;followers-only=0');
  await expect(counter).toHaveText(/1 чаттер/);
  await expect(counter).not.toContainText('фолловеров');
  await expect(popover).toContainText('Только для фолловеров · Замедление');
  await expect(popover).toContainText('Чаттерсов за время наблюдения1');
  for (let index = 0; index < 4; index++) {
    await send(privmsg({ id: 'warm' + index, login: 'writer' + index,
      userId: String(12000 + index * 2000), text: 'message ' + index }));
  }
  await expect(counter).toContainText('≈', { timeout: 130000 });
  const range = await counter.textContent();
  await mode('subs-only=1');
  await expect(popover).toContainText('Только для платных подписчиков');
  await expect(counter).toHaveText(range.trim());
  await mode('subs-only=0');
  await expect(popover).toContainText('Только для фолловеров');
  await expect(counter).toHaveText(range.trim());
  await counter.press('Escape');
  await page.locator('[data-tcx-ui="settings-button"]').click();
  const finalDownload = page.waitForEvent('download');
  await exportButton.click();
  const final = JSON.parse(await readFile(await (await finalDownload).path(), 'utf8'));
  const changes = final.events.filter(event => event.kind === 'room-mode').slice(-2);
  expect(changes).toMatchObject([
    { from: { subscribers: 0 }, to: { subscribers: 1 } },
    { from: { subscribers: 1 }, to: { subscribers: 0 } },
  ]);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.roomSocket.dispatchEvent(new Event('close'));
    window.roomSocket.dispatchEvent(new Event('open'));
  });
  await expect(counter).toHaveCount(0);
});
