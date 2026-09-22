import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (M6).
 *
 * The unit suite covers every glyph the stampers emit; what it cannot see is
 * the gesture layer — pointer capture, drag previews, which click drills and
 * which one moves. That is where regressions actually hide, so these tests
 * drive a real browser and a real canvas.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI !== undefined ? 2 : 0,
  reporter: process.env.CI !== undefined ? 'github' : [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // The tests read the document back through the app's own copy command,
    // rather than reaching into its internals with a test-only hook.
    permissions: ['clipboard-read', 'clipboard-write'],
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: process.env.CI === undefined,
    timeout: 60_000,
  },
});
