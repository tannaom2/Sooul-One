import { describe, expect, it } from "vitest";
import { summariseInteractions } from "../src/lib/interactions";

const line = (lines: { label: string; sessions: number }[], label: string) => lines.find((l) => l.label === label)?.sessions;

describe("summariseInteractions", () => {
  it("counts unique sessions, not repeat events", () => {
    const lines = summariseInteractions([
      { sessionId: "a", type: "CART_OPENED", metadata: null },
      { sessionId: "a", type: "CART_OPENED", metadata: null },
      { sessionId: "b", type: "CART_OPENED", metadata: null },
    ]);
    expect(line(lines, "Opened the basket")).toBe(2);
  });

  it("splits checkout by step and payment by method", () => {
    const lines = summariseInteractions([
      { sessionId: "a", type: "CHECKOUT_STEP", metadata: { step: "contact" } },
      { sessionId: "a", type: "CHECKOUT_STEP", metadata: { step: "address" } },
      { sessionId: "b", type: "CHECKOUT_STEP", metadata: { step: "contact" } },
      { sessionId: "a", type: "PAYMENT_METHOD_SELECTED", metadata: { method: "UPI" } },
      { sessionId: "b", type: "PAYMENT_METHOD_SELECTED", metadata: { method: "COD" } },
      { sessionId: "c", type: "PAYMENT_METHOD_SELECTED", metadata: { method: "RAZORPAY" } },
    ]);
    expect(line(lines, "Checkout: contact step")).toBe(2);
    expect(line(lines, "Checkout: address step")).toBe(1);
    expect(line(lines, "Checkout: payment step")).toBe(0);
    expect(line(lines, "Chose UPI")).toBe(1);
    expect(line(lines, "Chose cash on delivery")).toBe(1);
    expect(line(lines, "Chose card or other online")).toBe(1);
  });

  it("ignores malformed metadata instead of throwing", () => {
    const lines = summariseInteractions([{ sessionId: "a", type: "CHECKOUT_STEP", metadata: "nonsense" }]);
    expect(lines.every((l) => l.sessions === 0)).toBe(true);
  });
});
