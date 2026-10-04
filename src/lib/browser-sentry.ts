import * as Sentry from "@sentry/nextjs";
import { DENY_URLS, IGNORE_ERRORS, createGate, errorKey, scrubBreadcrumb, scrubEvent } from "@/lib/browser-errors";

/**
 * Sentry in the browser (F8). Loaded only when a DSN is set, and then as its
 * own chunk after the page starts (src/instrumentation-client.ts), so a
 * store without Sentry ships none of it and one with Sentry doesn't wait
 * for it. Errors only: no performance tracing, no session replay (both are
 * paid add-ons, and replay would record what people type).
 */

const gate = createGate();
let started = false;

/** Safe to call more than once: the first call wins. */
export function start(dsn: string): void {
  if (started) return;
  started = true;
  Sentry.init({
    dsn,
    // Reports go to our own site, which forwards them (src/app/api/errors/route.ts):
    // the security policy only lets the page talk to us, and ad blockers
    // block Sentry's own address.
    tunnel: "/api/errors",
    // The same names as the server's reports (production, preview), set at build time in next.config.ts.
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
    ignoreErrors: IGNORE_ERRORS,
    denyUrls: DENY_URLS,
    maxBreadcrumbs: 30,
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    beforeSend: (event) => (gate(errorKey(event)) ? scrubEvent(event) : null),
  });
}

/** An error page was shown. Starts Sentry first if the page broke before it had. */
export function capture(dsn: string, error: unknown, where: string): void {
  start(dsn);
  Sentry.captureException(error, { tags: { boundary: where } });
}
