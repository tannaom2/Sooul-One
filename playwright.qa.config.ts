import { defineConfig, devices } from "@playwright/test";

/**
 * The QA suite (tests/qa): concurrency, security, UI data-binding and
 * failure-mode tests against the DEMO server and DEMO database only.
 *
 * It doesn't start a server: run `npm run demo:start` first (a production
 * build on the demo database, email/payments/SMS switched off). Global setup
 * refuses to run unless that server can see a fixture that exists only in the
 * demo database, and teardown removes everything the suite created.
 *
 *   npm run test:qa
 */
export default defineConfig({
  testDir: "./tests/qa",
  fullyParallel: false,
  workers: 1, // files share fixtures (one last unit, one single-use code); concurrency is inside the tests
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  globalSetup: "./tests/qa/global-setup.ts",
  globalTeardown: "./tests/qa/global-teardown.ts",
  use: {
    baseURL: process.env.QA_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
