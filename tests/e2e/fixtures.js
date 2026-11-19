import { expect, test as base } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tests/e2e/fixtures.js -> project root
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DIST = path.join(ROOT, 'dist');
const FIXTURE = fs.readFileSync(
  path.join(ROOT, 'tests/e2e/fixtures/chat.html'),
  'utf8'
);

/**
 * The extension is declared with content_scripts.matches =
 * ["https://www.twitch.tv/*"], so it only runs there. Tests therefore route a
 * fake https://www.twitch.tv/chat fixture to the local HTML instead of touching
 * the real site: no network, no live Twitch, but the exact origin the manifest
 * expects.
 */
const TWITCH_URL = 'https://www.twitch.tv/testchannel';

async function installRoutes(page) {
  await page.route('https://www.twitch.tv/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: FIXTURE,
    })
  );
}

async function launchWithExtension(browserName) {
  if (browserName === 'chromium') {
    const { chromium } = await import('@playwright/test');
    return chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${path.join(DIST, 'chrome')}`,
        `--load-extension=${path.join(DIST, 'chrome')}`,
      ],
    });
  }

  const { firefox } = await import('@playwright/test');
  // Playwright launches Firefox without loading add-ons from the profile.
  // Use the existing web-ext tooling to install the build as a temporary add-on.
  const remoteModule = new URL('./lib/firefox/remote.js', import.meta.resolve('web-ext'));
  const { connectWithMaxRetries, findFreeTcpPort } = await import(remoteModule.href);
  const port = await findFreeTcpPort();
  const context = await firefox.launchPersistentContext('', {
    headless: true,
    args: [`--start-debugger-server=${port}`],
    firefoxUserPrefs: {
      'devtools.debugger.remote-enabled': true,
      'devtools.debugger.prompt-connection': false,
      'devtools.debugger.force-local': true,
    },
  });
  try {
    const remote = await connectWithMaxRetries({ port, maxRetries: 20 });
    try {
      await remote.installTemporaryAddon(path.join(DIST, 'firefox'));
    } finally {
      remote.disconnect();
    }
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  context: async ({ browserName }, use) => {
    const context = await launchWithExtension(browserName);
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await installRoutes(page);
    await page.goto(TWITCH_URL);
    await use(page);
  },
});

export { expect };
