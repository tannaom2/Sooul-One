import { NextResponse, after } from "next/server";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { MAX_EVENT_BYTES, clientEventSchema, toStoredEvent } from "@/lib/client-events";
import { limitPublic } from "@/server/rate-limit";

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

/**
 * The body as text, or null when empty or over `max` bytes. Stops reading as
 * soon as it passes the cap, so a body sent without a Content-Length (chunked)
 * isn't buffered whole either.
 */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  if (size === 0) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
