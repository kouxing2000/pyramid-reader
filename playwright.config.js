import { defineConfig } from '@playwright/test';

// E2E tests load src/ as an unpacked extension via the fixture in tests/e2e/fixtures.js, on the
// harness's Chromium or the browser PR_CHROME names.
export default defineConfig({
  testDir: './tests/e2e',
  // Side-panel round trips go through CDP; a loaded machine can stretch them past the 5s default.
  expect: { timeout: 10_000 },
  projects: [
    // Headless, the page at Playwright's default size: every spec but window.spec.js.
    { name: 'headless', testIgnore: /window\.spec\.js/ },
    // Headed, the page sized by the window: window.spec.js measures what the window shows, which
    // a headless run cannot. On Linux it needs a display (CI runs under xvfb-run).
    { name: 'headed', testMatch: /window\.spec\.js/, use: { headless: false, viewport: null } },
  ],
});
