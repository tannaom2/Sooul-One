/**
 * Runs in the browser before the page becomes interactive. Starts error
 * reporting (src/lib/browser-sentry.ts) when a DSN is set, as a separate
 * chunk so it never holds the page up. NEXT_PUBLIC_SENTRY_DSN is copied from
 * SENTRY_DSN at build time (next.config.ts), so the one setting switches on
 * both the server and the browser.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import("@/lib/browser-sentry").then((sentry) => sentry.start(dsn)).catch(() => {});
}
