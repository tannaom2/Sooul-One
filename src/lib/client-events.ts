import { z } from "zod";

/**
 * The storefront events a browser may record, and exactly what each may say.
 *
 * Anything arriving from a browser can be forged, so this is an allowlist:
 * unknown types and unknown fields are rejected, strings are short, and
 * nothing here can carry personal data (no names, emails, phones, addresses).
 * Server-side events (VISIT, ADD_TO_CART, ORDER_PLACED...) are recorded where
 * they happen and are deliberately not accepted from the browser, so the
 * funnel's key numbers can't be inflated from outside.
 */
const id = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);

export const clientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CHECKOUT_STARTED") }).strict(),
  z.object({ type: z.literal("CART_OPENED") }).strict(),
  z
    .object({
      type: z.literal("OFFER_SHOWN"),
      offer: z.enum(["bundle", "free_delivery"]),
      offerId: id.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("OFFER_APPLIED"),
      offer: z.enum(["bundle", "free_delivery"]),
      offerId: id.optional(),
    })
    .strict(),
  z.object({ type: z.literal("CHECKOUT_STEP"), step: z.enum(["contact", "address", "payment"]) }).strict(),
  z.object({ type: z.literal("PAYMENT_METHOD_SELECTED"), method: z.enum(["UPI", "CARD", "COD", "RAZORPAY"]) }).strict(),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;

/** Largest body the endpoint will read; every valid event is far smaller. */
export const MAX_EVENT_BYTES = 512;

/** Split a validated event into the stored type and its metadata. */
export function toStoredEvent(event: ClientEvent): { type: ClientEvent["type"]; metadata?: Record<string, string> } {
  const { type, ...rest } = event;
  return Object.keys(rest).length ? { type, metadata: rest as Record<string, string> } : { type };
}
