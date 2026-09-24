import { NextResponse } from "next/server";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { MAX_EVENT_BYTES, clientEventSchema, toStoredEvent } from "@/lib/client-events";

/**
 * Storefront interaction events from the browser (src/lib/track.ts).
 *
 * Always answers 204 so a tracking call can never surface an error to a
 * shopper; invalid or oversized bodies are simply not recorded. Events
 * without a session cookie are dropped: they can't join a funnel anyway.
 */
export async function POST(request: Request) {
  const sessionId = await readSessionId();
  const raw = await request.text().catch(() => "");
  if (!sessionId || raw.length === 0 || raw.length > MAX_EVENT_BYTES) {
    return new NextResponse(null, { status: 204 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const parsed = clientEventSchema.safeParse(body);
  if (parsed.success) {
    const { type, metadata } = toStoredEvent(parsed.data);
    void recordEvent(sessionId, type, { metadata });
  }
  return new NextResponse(null, { status: 204 });
}
