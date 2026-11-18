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
  await expect(page.locator('[data-tcx-ui="real-viewers"]')).toBeVisible();
  await expect(page.locator('[data-tcx-ui="settings-button"]')).toBeVisible();
});

test('the viewer counter shows a percentage or a range in parentheses', async ({
  page,
}) => {
  const text = page.locator('[data-tcx-ui="real-viewers"]');
  await expect(text).toHaveText(/\(.*(\d+%|≈)/, { timeout: 15000 });
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
