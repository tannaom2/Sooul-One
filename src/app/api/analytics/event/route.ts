import { NextResponse, after } from "next/server";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { MAX_EVENT_BYTES, clientEventSchema, toStoredEvent } from "@/lib/client-events";
import { limitPublic } from "@/server/rate-limit";
import { readCapped } from "@/server/read-capped";

/**
 * Storefront interaction events from the browser (src/lib/track.ts).
 *
 * Always answers 204 so a tracking call can never surface an error to a
 * shopper; invalid or oversized bodies are simply not recorded. Events
 * without a session cookie are dropped: they can't join a funnel anyway.
 */
export async function POST(request: Request) {
  const sessionId = await readSessionId();
  // Size is checked from the header before reading anything (audit L6).
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!sessionId || declared > MAX_EVENT_BYTES) return new NextResponse(null, { status: 204 });
  // Over the limit: dropped quietly, like any other event that isn't recorded.
  if (await limitPublic("events")) return new NextResponse(null, { status: 204 });

  const raw = await readCapped(request, MAX_EVENT_BYTES);
  if (!raw) return new NextResponse(null, { status: 204 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const parsed = clientEventSchema.safeParse(body);
  if (parsed.success) {
    const { type, metadata } = toStoredEvent(parsed.data);
    after(() => recordEvent(sessionId, type, { metadata }));
  }
  return new NextResponse(null, { status: 204 });
}
