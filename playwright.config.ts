import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end config.
 *
 * Runs against a real dev server and a real database (DATABASE_URL from
 * .env.local, same as `npm run dev`) — not a mock. The checkout path lives or
 * dies on real Postgres behaviour (the FEFO transaction, the GST split), so a
 * mocked backend would pass while the real thing broke.
 *
 * `webServer` starts `next dev` itself (in CI, `next start` against the build
 * the workflow just made) and waits for /api/health before the first test
 * runs, so `npm run test:e2e` is a single command with nothing to start by hand.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // tests share one product's stock — parallel runs would race each other
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",

  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // CI tests the production build it has just made; locally, the dev server.
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
    // Generous: a cold Next.js compile plus a Neon free-tier database waking
    // from suspend can both land inside this window on a slow first run.
    timeout: 120_000,
  },
});
