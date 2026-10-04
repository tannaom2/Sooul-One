/**
 * For the error pages ("Something didn't load"): tells Sentry a shopper saw
 * one. React catches these errors itself, so the browser never treats them
 * as uncaught and Sentry wouldn't hear of them otherwise.
 *
 * An error with a digest came from the server and was already reported
 * there (onRequestError in src/instrumentation.ts), so it's skipped rather
 * than counted twice. Does nothing without a DSN.
 */
export function reportClientError(error: Error & { digest?: string }, where: string): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || error.digest) return;
  void import("@/lib/browser-sentry").then((sentry) => sentry.capture(dsn, error, where)).catch(() => {});
}
