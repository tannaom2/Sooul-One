import { describe, expect, it } from "vitest";
import {
  CLOSE_REASONS,
  UNPAID_EXPIRY_MINUTES,
  allowedMoves,
  checkMove,
  isAbandoned,
  releasesStock,
} from "../src/lib/order-lifecycle";

const cod = (status: string) => ({ status, paidOnline: false });

describe("allowedMoves", () => {
  it("walks a cash-on-delivery order forward: packing, shipped, delivered", () => {
    expect(allowedMoves(cod("PROCESSING"))).toEqual(["SHIPPED", "CANCELLED"]);
    expect(allowedMoves(cod("SHIPPED"))).toEqual(["DELIVERED", "RTO"]);
    expect(allowedMoves(cod("DELIVERED"))).toEqual(["RETURNED"]);
  });

  it("never lets an unpaid online order be shipped", () => {
    expect(allowedMoves(cod("PENDING_PAYMENT"))).toEqual(["CANCELLED"]);
    expect(checkMove(cod("PENDING_PAYMENT"), "SHIPPED").ok).toBe(false);
  });

  it("offers nothing once an order has ended", () => {
    for (const status of ["CANCELLED", "REFUNDED", "RTO", "RETURNED"]) expect(allowedMoves(cod(status))).toEqual([]);
  });

  it("doesn't move backwards", () => {
    expect(checkMove(cod("DELIVERED"), "PROCESSING").ok).toBe(false);
    expect(checkMove(cod("SHIPPED"), "PROCESSING").ok).toBe(false);
  });

  it("leaves payment states to the webhook", () => {
    for (const status of ["PENDING_PAYMENT", "PROCESSING", "SHIPPED"]) {
      expect(allowedMoves(cod(status))).not.toContain("PAID");
      expect(allowedMoves(cod(status))).not.toContain("REFUNDED");
    }
  });

  it("won't cancel an order paid online until refunds exist, and says why", () => {
    const paid = { status: "PROCESSING", paidOnline: true };
    expect(allowedMoves(paid)).toEqual(["SHIPPED"]);
    const check = checkMove(paid, "CANCELLED", "CUSTOMER_REQUEST");
    expect(check.ok).toBe(false);
    expect(!check.ok && check.message).toMatch(/refund/i);
  });
});

describe("checkMove reasons", () => {
  it("requires a reason from the right list when an order ends", () => {
    expect(checkMove(cod("PROCESSING"), "CANCELLED").ok).toBe(false);
    expect(checkMove(cod("PROCESSING"), "CANCELLED", "REFUSED_AT_DOOR").ok).toBe(false); // an RTO reason
    expect(checkMove(cod("PROCESSING"), "CANCELLED", "CUSTOMER_REQUEST").ok).toBe(true);
    expect(checkMove(cod("SHIPPED"), "RTO", "REFUSED_AT_DOOR").ok).toBe(true);
  });

  it("needs no reason to move forward", () => {
    expect(checkMove(cod("PROCESSING"), "SHIPPED").ok).toBe(true);
  });

  it("has a reason list for every way an order can end", () => {
    for (const list of Object.values(CLOSE_REASONS)) expect(list.length).toBeGreaterThan(0);
  });
});

describe("releasesStock", () => {
  it("returns stock only for a cancellation, never for a parcel that came back", () => {
    expect(releasesStock("CANCELLED")).toBe(true);
    expect(releasesStock("RTO")).toBe(false);
    expect(releasesStock("RETURNED")).toBe(false);
    expect(releasesStock("SHIPPED")).toBe(false);
  });
});

describe("isAbandoned", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("closes unpaid and failed online orders after the expiry window", () => {
    expect(isAbandoned({ status: "PENDING_PAYMENT", placedAt: ago(UNPAID_EXPIRY_MINUTES) }, now)).toBe(true);
    expect(isAbandoned({ status: "FAILED", placedAt: ago(45) }, now)).toBe(true);
  });

  it("leaves a shopper who's still paying alone", () => {
    expect(isAbandoned({ status: "PENDING_PAYMENT", placedAt: ago(UNPAID_EXPIRY_MINUTES - 1) }, now)).toBe(false);
  });

  it("never touches cash-on-delivery or paid orders", () => {
    for (const status of ["PROCESSING", "PAID", "SHIPPED"]) expect(isAbandoned({ status, placedAt: ago(600) }, now)).toBe(false);
  });
});
