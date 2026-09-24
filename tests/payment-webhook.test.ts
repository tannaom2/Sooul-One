import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseRazorpayWebhook, paymentTransition, verifyRazorpaySignature } from "../src/lib/payment-webhook";

const SECRET = "whsec_test_only";
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex");

/** Shaped like Razorpay's documented payment.* webhook bodies. */
const paymentEvent = (event: string, entity: Record<string, unknown> = {}) =>
  JSON.stringify({
    entity: "event",
    event,
    payload: {
      payment: {
        entity: { id: "pay_1", order_id: "order_1", amount: 49900, currency: "INR", method: "upi", ...entity },
      },
    },
  });

/** Applies a transition the way the route's conditional update does. */
function apply(status: string, event: string): string {
  const t = paymentTransition(event);
  return t && (t.from as readonly string[]).includes(status) ? t.to : status;
}

describe("verifyRazorpaySignature", () => {
  const body = paymentEvent("payment.captured");

  it("accepts a body signed with the webhook secret", () => {
    expect(verifyRazorpaySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a missing signature, the wrong secret, or a changed body", () => {
    expect(verifyRazorpaySignature(body, null, SECRET)).toBe(false);
    expect(verifyRazorpaySignature(body, sign(body, "someone-else"), SECRET)).toBe(false);
    expect(verifyRazorpaySignature(body.replace("49900", "100"), sign(body), SECRET)).toBe(false);
    expect(verifyRazorpaySignature(body, "short", SECRET)).toBe(false);
  });
});

describe("paymentTransition", () => {
  it("marks a waiting order paid on capture", () => {
    expect(apply("PENDING_PAYMENT", "payment.captured")).toBe("PAID");
  });

  it("still marks the order paid when a capture follows a failed attempt (UPI retry)", () => {
    const afterFailure = apply("PENDING_PAYMENT", "payment.failed");
    expect(afterFailure).toBe("FAILED");
    expect(apply(afterFailure, "payment.captured")).toBe("PAID");
  });

  it("never lets a late failure downgrade a paid or shipped order", () => {
    for (const status of ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"]) {
      expect(apply(status, "payment.failed")).toBe(status);
    }
  });

  it("does nothing on a repeated capture, so the email and basket clearing run once", () => {
    expect(apply("PAID", "payment.captured")).toBe("PAID");
    expect(paymentTransition("payment.captured")!.from).not.toContain("PAID");
  });

  it("refunds a paid or cancelled order, but not one that was never paid", () => {
    expect(apply("DELIVERED", "refund.processed")).toBe("REFUNDED");
    expect(apply("CANCELLED", "refund.processed")).toBe("REFUNDED");
    expect(apply("PENDING_PAYMENT", "refund.processed")).toBe("PENDING_PAYMENT");
  });

  it("ignores events it doesn't handle", () => {
    expect(paymentTransition("order.paid")).toBeNull();
  });
});

describe("parseRazorpayWebhook", () => {
  it("reads the payment fields the route uses", () => {
    const parsed = parseRazorpayWebhook(paymentEvent("payment.failed", { error_description: "Payment declined by bank" }));
    expect(parsed).toEqual({
      event: "payment.failed",
      payment: { id: "pay_1", razorpayOrderId: "order_1", amountPaise: 49900, method: "upi", errorReason: "Payment declined by bank" },
      refund: null,
    });
  });

  it("returns no payment when there's no order id, and null for non-JSON", () => {
    expect(parseRazorpayWebhook(JSON.stringify({ event: "payment.captured", payload: {} }))?.payment).toBeNull();
    expect(parseRazorpayWebhook("not json")).toBeNull();
  });
});
