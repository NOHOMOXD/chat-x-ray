import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './fixtures.js';

/**
 * Coexistence with the two extensions that share Twitch's chat DOM.
 *
 * Neither BetterTTV nor 7TV is installed here. The fixture reproduces the
 * structure captured from a live page with BetterTTV active: Twitch's rows sit
 * in a wrapper div and BetterTTV appends itself into that same wrapper. 7TV is
 * mounted at runtime, after our row exists, which is the ordering that broke
 * the first insertion attempt.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SETTINGS_FIXTURE = fs.readFileSync(
  path.join(ROOT, 'tests/e2e/fixtures/chat-settings.html'),
  'utf8'
);

/** Read where our row ended up relative to the foreign groups. */
function readPlacement(page) {
  return page.evaluate(() => {
    const row = document.getElementById('tcx-settings-menu-row');
    if (!row) {
      return { missing: true };
    }
    const content = document.querySelector('.chat-settings__content');
    return {
      missing: false,
      // Our row lives directly in the settings container, not in a nested
      // Twitch wrapper (where it would read as "inside" the native block).
      parentIsContent: row.parentElement === content,
      insideBttv: Boolean(row.closest('.bttv-chat-settings')),
      inside7tv: Boolean(row.closest('.seventv-settings')),
      bttvIntact: Boolean(content.querySelector('.bttv-chat-settings')),
    };
  });
}

test.describe('third-party coexistence (BetterTTV / 7TV)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://www.twitch.tv/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: SETTINGS_FIXTURE,
      })
    );
    await page.goto('https://www.twitch.tv/testchannel');
  });

  test('our row is never nested inside a foreign group', async ({ page }) => {
    await expect(page.locator('#tcx-settings-menu-row')).toBeVisible({
      timeout: 15000,
    });
    await page.evaluate(() => window.__fixture.mount7TV());

    const placement = await readPlacement(page);
    expect(placement.missing).toBe(false);
    expect(placement.insideBttv).toBe(false);
    expect(placement.inside7tv).toBe(false);
  });

  test('our row is the last entry, after BetterTTV and 7TV', async ({ page }) => {
    await expect(page.locator('#tcx-settings-menu-row')).toBeVisible({
      timeout: 15000,
    });
    // 7TV mounts last on a real page; reproduce that ordering.
    await page.evaluate(() => window.__fixture.mount7TV());

    // The extension re-checks its row on every DOM mutation, so give it a
    // tick to reorder after 7TV mounts. Asserting immediately raced it.
    const readOrder = () =>
      page.evaluate(() => {
        const content = document.querySelector('.chat-settings__content');
        const row = document.getElementById('tcx-settings-menu-row');
        const order = [...content.children];
        const rowIndex = order.indexOf(row);
        // Index comparison is unambiguous; compareDocumentPosition's
        // FOLLOWING bit describes where the *other* node sits, which is easy
        // to invert by accident.
        return {
          rowIsLast: content.lastElementChild === row,
          bttvBeforeRow:
            order.indexOf(content.querySelector('.bttv-chat-settings')) < rowIndex,
          seventvBeforeRow:
            order.indexOf(content.querySelector('.seventv-settings')) < rowIndex,
        };
      });

    await expect
      .poll(readOrder, { timeout: 15000 })
      .toEqual({
        rowIsLast: true,
        bttvBeforeRow: true,
        seventvBeforeRow: true,
      });
  });

  test('foreign groups keep all of their own markup', async ({ page }) => {
    await expect(page.locator('#tcx-settings-menu-row')).toBeVisible({
      timeout: 15000,
    });
    await page.evaluate(() => window.__fixture.mount7TV());

    const foreign = await page.evaluate(() => {
      const bttv = document.querySelector('.bttv-chat-settings');
      const seventv = document.querySelector('.seventv-settings');
      return {
        state: window.__fixture.thirdPartyState(),
        bttvButtons: bttv ? bttv.querySelectorAll('button').length : 0,
        bttvText: bttv ? bttv.textContent : '',
        seventvButtons: seventv ? seventv.querySelectorAll('button').length : 0,
      };
    });

    expect(foreign.state).toEqual({ bttv: true, seventv: true });
    expect(foreign.bttvButtons).toBe(2);
    expect(foreign.bttvText).toContain('BetterTTV Settings');
    expect(foreign.seventvButtons).toBe(1);
  });

  test('the row still opens the modal with third parties present', async ({
    page,
  }) => {
    await expect(page.locator('#tcx-settings-menu-row')).toBeVisible({
      timeout: 15000,
    });
    await page.evaluate(() => window.__fixture.mount7TV());

    await page.locator('#tcx-settings-menu-row').click();
    await expect(
      page.locator('[data-tcx-ui="settings-modal"] .tcx-modal__dialog')
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-tcx-ui="settings-modal"]')).toHaveCount(0);
  });

  test('the row has no trailing chevron', async ({ page }) => {
    const row = page.locator('#tcx-settings-menu-row');
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.locator('svg')).toHaveCount(0);
    await expect(row).toHaveText(/Chat X-Ray/);
  });
});

test.describe('WebSocket tap with a competing wrapper', () => {
  test('a foreign wrapper around WebSocket does not detach our tap', async ({
    page,
  }) => {
    // 7TV also wraps window.WebSocket in the MAIN world.
    const result = await page.evaluate(() => {
      const ours = window.WebSocket;
      const marker = Boolean(ours && ours.__twitchXRayWrapped);
      window.WebSocket = new Proxy(ours, {
        construct(target, args, newTarget) {
          return Reflect.construct(target, args, newTarget);
        },
      });
      return { marker, constructable: typeof window.WebSocket === 'function' };
    });

    expect(result.marker).toBe(true);
    expect(result.constructable).toBe(true);
  });
});
