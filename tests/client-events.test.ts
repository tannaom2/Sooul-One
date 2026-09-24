import { describe, expect, it } from "vitest";
import { clientEventSchema, toStoredEvent } from "../src/lib/client-events";

const ok = (v: unknown) => clientEventSchema.safeParse(v).success;

describe("clientEventSchema", () => {
  it("accepts each allowed event in its exact shape", () => {
    expect(ok({ type: "CART_OPENED" })).toBe(true);
    expect(ok({ type: "OFFER_SHOWN", offer: "free_delivery" })).toBe(true);
    expect(ok({ type: "OFFER_APPLIED", offer: "bundle", offerId: "cmu_bundle-1" })).toBe(true);
    expect(ok({ type: "CHECKOUT_STEP", step: "address" })).toBe(true);
    expect(ok({ type: "PAYMENT_METHOD_SELECTED", method: "UPI" })).toBe(true);
  });

  it("refuses server-side events, so the funnel can't be inflated from a browser", () => {
    for (const type of ["VISIT", "PRODUCT_VIEW", "ADD_TO_CART", "ORDER_PLACED", "ORDER_PAID"]) {
      expect(ok({ type })).toBe(false);
    }
  });

  it("refuses unknown fields, which is where personal data would sneak in", () => {
    expect(ok({ type: "CART_OPENED", email: "a@b.com" })).toBe(false);
    expect(ok({ type: "CHECKOUT_STEP", step: "address", pincode: "411001" })).toBe(false);
  });

  it("refuses values outside the allowed sets and oversized ids", () => {
    expect(ok({ type: "CHECKOUT_STEP", step: "review" })).toBe(false);
    expect(ok({ type: "PAYMENT_METHOD_SELECTED", method: "CRYPTO" })).toBe(false);
    expect(ok({ type: "OFFER_SHOWN", offer: "bundle", offerId: "x".repeat(41) })).toBe(false);
    expect(ok({ type: "OFFER_SHOWN", offer: "bundle", offerId: "<script>" })).toBe(false);
  });
});

describe("toStoredEvent", () => {
  it("moves the fields into metadata, and stores none when there are none", () => {
    expect(toStoredEvent({ type: "CHECKOUT_STEP", step: "payment" })).toEqual({ type: "CHECKOUT_STEP", metadata: { step: "payment" } });
    expect(toStoredEvent({ type: "CART_OPENED" })).toEqual({ type: "CART_OPENED" });
  });
});
