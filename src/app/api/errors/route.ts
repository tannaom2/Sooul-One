import { NextResponse } from "next/server";
import { envelopeTarget } from "@/lib/browser-errors";
import { limitPublic } from "@/server/rate-limit";
import { readCapped } from "@/server/read-capped";

export const runtime = "nodejs";

/**
 * Error reports from shoppers' browsers (src/lib/browser-sentry.ts), passed
 * on to Sentry. Through our own site because the security policy only lets
 * pages talk to us (src/lib/csp.ts), and ad blockers block Sentry's address.
 *
 * Only reports for our own Sentry project are forwarded (envelopeTarget), so
 * nobody can use this to send data elsewhere; size and rate are capped. The
 * shopper's address isn't passed on: Sentry sees our server, not them.
 * Answers 204 whenever a report isn't forwarded, so a browser never retries
 * or shows anything.
 */

/** Far above a real report (an error, its stack and 30 breadcrumbs is a few KB). */
const MAX_ENVELOPE_BYTES = 200_000;

const dropped = () => new NextResponse(null, { status: 204 });

export async function POST(request: Request) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return dropped();
  if (Number(request.headers.get("content-length") ?? "0") > MAX_ENVELOPE_BYTES) return dropped();
  if (await limitPublic("browserErrors")) return dropped();

  const envelope = await readCapped(request, MAX_ENVELOPE_BYTES);
  const target = envelope ? envelopeTarget(envelope, dsn) : null;
  if (!envelope || !target) return dropped();

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
      signal: AbortSignal.timeout(5000),
    });
    // Sentry's own "slow down" (429) goes back to the browser, which then backs off.
    return new NextResponse(null, { status: upstream.status === 429 ? 429 : 204, headers: retryAfter(upstream) });
  } catch {
    // Sentry unreachable: not worth an error report of its own.
    return dropped();
  }
}

function retryAfter(upstream: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of ["retry-after", "x-sentry-rate-limits"]) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}
