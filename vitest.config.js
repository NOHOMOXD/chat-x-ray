import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // happy-dom gives tests a real DOM (querySelector, classList, events,
    // MutationObserver) instead of the hand-rolled fake nodes the old suite
    // used. Tests that only touch pure logic still run fine under it.
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/platform/inject.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
