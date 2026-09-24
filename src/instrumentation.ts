import * as Sentry from "@sentry/nextjs";

/**
 * Error reporting. Without SENTRY_DSN nothing is initialised and every
 * Sentry call is a no-op — errors still reach the server log through
 * reportError() in src/lib/observability.ts.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    // Errors only — no performance tracing until there's a reason to pay for it.
    tracesSampleRate: 0,
    // The SDK's defaults send cookies, headers, bodies and query strings.
    // Here that would mean the admin session cookie, checkout addresses and
    // phone numbers, the private ?t= order link and admin searches by email.
    // Collect none of it: the stack trace and route are enough to debug.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent", "content-type"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
  });
}

// Every unhandled error from a page, route handler or server action,
// including the ones nobody wrapped in a try/catch.
export const onRequestError = Sentry.captureRequestError;
