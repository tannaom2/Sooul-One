/**
 * The decisions behind the Razorpay webhook (src/app/api/webhooks/razorpay):
 * is the delivery genuine, and which order statuses may each event move.
 * Pure, with no "server-only" import, so it's tested directly; the route
 * applies these rules with a conditional update, so exactly one of several
 * simultaneous deliveries acts on an order.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

type Status = "PENDING_PAYMENT" | "PAID" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED" | "FAILED";

/**
 * HMAC-SHA256 of the raw body, compared in constant time. The raw bytes
 * matter: re-serialising parsed JSON changes them and nothing would match.
 */
export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  const provided = Buffer.from(signature, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export interface PaymentTransition {
  /** The order must be in one of these for the event to act. */
  readonly from: readonly Status[];
  readonly to: Status;
  readonly paymentStatus: string;
}

/**
 * What each payment event may do to an order. `from` is the whole guard:
 *
 * - A capture wins over an earlier failed attempt. Razorpay lets a shopper
 *   retry in the same payment window, so "failed, then captured" is the
 *   normal UPI retry, and the capture must still mark the order paid.
 * - A failure only moves an order still waiting for payment. It arrives out
 *   of order often enough that it must never downgrade a paid order.
 * - A second delivery of the same event finds the order already moved and
 *   does nothing, so emails and basket clearing happen once.
 */
export function paymentTransition(event: string): PaymentTransition | null {
  switch (event) {
    case "payment.captured":
      return { from: ["PENDING_PAYMENT", "FAILED"], to: "PAID", paymentStatus: "captured" };
    case "payment.failed":
      return { from: ["PENDING_PAYMENT"], to: "FAILED", paymentStatus: "failed" };
    case "refund.processed":
      return { from: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"], to: "REFUNDED", paymentStatus: "refunded" };
    default:
      return null;
  }
}

export interface WebhookPayment {
  readonly id: string | null;
  readonly razorpayOrderId: string;
  readonly amountPaise: number | null;
  readonly method: string | null;
  readonly errorReason: string | null;
}

export interface ParsedWebhook {
  readonly event: string;
  readonly payment: WebhookPayment | null;
  readonly refund: { readonly id: string | null; readonly amountPaise: number | null } | null;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The fields the route uses, read defensively from a verified body. Null if it isn't JSON. */
export function parseRazorpayWebhook(rawBody: string): ParsedWebhook | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const b = body as { event?: unknown; payload?: { payment?: { entity?: Record<string, unknown> }; refund?: { entity?: Record<string, unknown> } } };
  const p = b?.payload?.payment?.entity;
  const r = b?.payload?.refund?.entity;
  const razorpayOrderId = str(p?.order_id);
  return {
    event: str(b?.event) ?? "",
    payment: razorpayOrderId
      ? {
          id: str(p?.id),
          razorpayOrderId,
          amountPaise: num(p?.amount),
          method: str(p?.method),
          errorReason: str(p?.error_description) ?? str(p?.error_reason),
        }
      : null,
    refund: r ? { id: str(r.id), amountPaise: num(r.amount) } : null,
  };
}
