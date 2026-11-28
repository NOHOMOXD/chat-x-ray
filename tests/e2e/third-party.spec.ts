import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './fixtures.ts';

/** Check that third-party settings remain available alongside Chat X-Ray. */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SETTINGS_FIXTURE = fs.readFileSync(
  path.join(ROOT, 'tests/e2e/fixtures/chat-settings.html'),
  'utf8'
);

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

  test('foreign groups keep all of their own markup', async ({ page }) => {
    await expect(page.locator('#tcx-settings-menu-row')).toHaveCount(0);
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

});

test.describe('WebSocket tap with a competing wrapper', () => {
  test('a foreign wrapper around WebSocket does not detach our tap', async ({
    page,
  }) => {
    // 7TV also wraps window.WebSocket in the MAIN world.
    const result = await page.evaluate(() => {
      const ours = window.WebSocket;
      const marker = Boolean(ours && '__twitchXRayWrapped' in ours && ours.__twitchXRayWrapped);
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
