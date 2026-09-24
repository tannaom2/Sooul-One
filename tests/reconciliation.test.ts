import { describe, expect, it } from "vitest";
import {
  compareOrderToRazorpay,
  checkPaymentHasLocalOrder,
  type LocalOrderLike,
} from "../src/lib/reconciliation-compare";

const order = (over: Partial<LocalOrderLike> = {}): LocalOrderLike => ({
  orderNumber: "SO-1",
  status: "PAID",
  totalAmountPaise: 50000,
  ...over,
});

describe("compareOrderToRazorpay", () => {
  it("finds nothing when everything agrees", () => {
    const findings = compareOrderToRazorpay(order(), "order_1", { status: "paid", amount_paid: 50000 });
    expect(findings).toEqual([]);
  });

  it("flags an amount mismatch", () => {
    const findings = compareOrderToRazorpay(order(), "order_1", { status: "paid", amount_paid: 49000 });
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("AMOUNT_MISMATCH");
  });

  it("flags when we say paid but Razorpay disagrees", () => {
    const findings = compareOrderToRazorpay(order({ status: "PAID" }), "order_1", {
      status: "created",
      amount_paid: 0,
    });
    expect(findings.map((f) => f.kind)).toContain("LOCAL_PAID_RAZORPAY_DISAGREES");
  });

  it("flags a missed webhook: Razorpay paid, we're still pending", () => {
    const findings = compareOrderToRazorpay(order({ status: "PENDING_PAYMENT" }), "order_1", {
      status: "paid",
      amount_paid: 50000,
    });
    expect(findings.map((f) => f.kind)).toContain("LOCAL_PENDING_RAZORPAY_PAID");
  });

  it("does not flag a legitimately unpaid order still pending", () => {
    const findings = compareOrderToRazorpay(order({ status: "PENDING_PAYMENT" }), "order_1", {
      status: "created",
      amount_paid: 0,
    });
    expect(findings).toEqual([]);
  });

  it("does not flag a failed order Razorpay also shows as unpaid", () => {
    const findings = compareOrderToRazorpay(order({ status: "FAILED" }), "order_1", {
      status: "created",
      amount_paid: 0,
    });
    expect(findings).toEqual([]);
  });

  it("flags a failed or cancelled order that Razorpay shows as paid", () => {
    for (const status of ["FAILED", "CANCELLED"]) {
      const findings = compareOrderToRazorpay(order({ status }), "order_1", { status: "paid", amount_paid: 50000 });
      expect(findings.map((f) => f.kind)).toEqual(["LOCAL_PENDING_RAZORPAY_PAID"]);
    }
  });
});

describe("checkPaymentHasLocalOrder", () => {
  it("ignores payments that were not captured", () => {
    const result = checkPaymentHasLocalOrder(
      { id: "pay_1", status: "failed", amount: 50000, order_id: "order_1" },
      new Map(),
    );
    expect(result).toBeNull();
  });

  it("finds nothing when a local order matches", () => {
    const local = new Map([["order_1", order()]]);
    const result = checkPaymentHasLocalOrder(
      { id: "pay_1", status: "captured", amount: 50000, order_id: "order_1" },
      local,
    );
    expect(result).toBeNull();
  });

  it("flags a captured payment with no matching local order — the core fraud/bug check", () => {
    const result = checkPaymentHasLocalOrder(
      { id: "pay_1", status: "captured", amount: 50000, order_id: "order_missing" },
      new Map(),
    );
    expect(result?.kind).toBe("PAYMENT_WITHOUT_LOCAL_ORDER");
    expect(result?.razorpayPaymentId).toBe("pay_1");
  });

  it("flags a captured payment with no order id at all", () => {
    const result = checkPaymentHasLocalOrder(
      { id: "pay_1", status: "captured", amount: 50000, order_id: null },
      new Map(),
    );
    expect(result?.kind).toBe("PAYMENT_WITHOUT_LOCAL_ORDER");
  });
});
