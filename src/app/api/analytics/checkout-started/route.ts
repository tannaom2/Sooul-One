import { NextResponse } from "next/server";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";

/**
 * The checkout page is a client component (form state, live re-quoting), so
 * it has no server-side render hook to log CHECKOUT_STARTED from directly —
 * this tiny endpoint is that hook, called once on mount.
 *
 * No session cookie yet means no cart, which means this page shouldn't be
 * reachable in the first place — nothing to record either way.
 */
export async function POST() {
  const sessionId = await readSessionId();
  if (sessionId) void recordEvent(sessionId, "CHECKOUT_STARTED");
  return NextResponse.json({ ok: true });
}
