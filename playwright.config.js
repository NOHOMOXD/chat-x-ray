import { defineConfig } from '@playwright/test';

// Playwright forces color in workers. Preserve a no-color environment without
// passing conflicting variables to Node in those workers.
if (process.env.NO_COLOR !== undefined && process.env.FORCE_COLOR === undefined) {
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR = '0';
}

/*
 * Extension E2E. Both projects load the real built extension into a real
 * browser and drive a structurally faithful Twitch chat fixture.
 *
 * Playwright's bundled Chromium is the only Chromium build that still honours
 * --load-extension (Google Chrome removed it), so the "chrome" project uses it.
 * The "firefox" project runs the Firefox build, which is how we verify that
 * content_scripts.world: "MAIN" actually works outside Chromium.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: [['list']],
  use: {
    trace: 'off',
  },
  projects: [
    {
      name: 'chrome',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
  ],
});
