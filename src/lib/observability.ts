import "server-only";
import * as Sentry from "@sentry/nextjs";

/**
 * For errors that are caught and handled — a fallback is shown, so nothing
 * crashes — but that someone still needs to know about. Logs one structured
 * line and forwards to Sentry (a no-op when SENTRY_DSN isn't set).
 *
 * Keep `context` to ids and counts: never names, emails, addresses or phone
 * numbers.
 */
export function reportError(scope: string, error: unknown, context?: Record<string, unknown>): void {
  console.error(`[${scope}]`, context ?? "", error);
  Sentry.captureException(error, { tags: { scope }, extra: context });
}
