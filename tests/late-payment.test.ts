import { beforeEach, describe, expect, it, vi } from "vitest";
import { lateCaptureAction, sweepDecision } from "@/lib/payment-webhook";
import { CHECKOUT_TIMEOUT_SECONDS, UNPAID_EXPIRY_MINUTES } from "@/lib/order-lifecycle";

/**
 * Launch defect D2: a payment that lands after the unpaid sweep must never
 * leave a paid order cancelled. The window closes first, the sweep asks
 * Razorpay before cancelling, and a late capture puts the order back or
 * refunds it.
 */

const h = vi.hoisted(() => ({
  db: {
    order: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    walletEntry: { findFirst: vi.fn() },
    referral: { findUnique: vi.fn() },
    coupon: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  fetchOrderPayments: vi.fn(),
  markPaidFromSweep: vi.fn(async () => true),
  razorpayClient: vi.fn(() => ({}) as unknown),
  releaseStock: vi.fn(),
  takeStock: vi.fn(async () => null as string | null),
  refund: vi.fn(async () => ({ id: "rfnd_1" })),
  recordOrderEvent: vi.fn(),
  afterPaymentCaptured: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => fn() }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/cron-auth", () => ({ cronAuthorized: () => true }));
vi.mock("@/lib/cache-tags", () => ({ CATALOG_TAG: "catalog", expireTag: vi.fn(), refreshTag: vi.fn() }));
vi.mock("@/lib/order-events", () => ({ recordOrderEvent: h.recordOrderEvent }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/server/referrals", () => ({ onOrderStatusChanged: vi.fn() }));
vi.mock("@/server/order-stock", () => ({ releaseStock: h.releaseStock, takeStock: h.takeStock }));
vi.mock("@/server/messages", async () => ({ deliverNow: vi.fn(async () => []), messageKey: (await vi.importActual<typeof import("@/lib/messages")>("@/lib/messages")).messageKey }));

describe("the rules", () => {
  it("closes the payment window well before the sweep closes the order", () => {
    expect(CHECKOUT_TIMEOUT_SECONDS * 1000).toBeLessThanOrEqual((UNPAID_EXPIRY_MINUTES * 60_000) / 2);
  });

  it("marks paid on a capture, waits on an authorization, cancels when nothing was paid", () => {
    expect(sweepDecision([{ status: "failed" }, { status: "captured" }])).toBe("paid");
    expect(sweepDecision([{ status: "authorized" }])).toBe("wait");
    expect(sweepDecision([{ status: "failed" }])).toBe("cancel");
    expect(sweepDecision([])).toBe("cancel");
  });

  it("puts back an order the sweep closed, unless wallet credit or a referral was unwound", () => {
    const swept = { status: "CANCELLED", closeReason: "PAYMENT_NOT_COMPLETED", usedWallet: false, hasReferral: false };
    expect(lateCaptureAction(swept)).toBe("reinstate");
    expect(lateCaptureAction({ ...swept, usedWallet: true })).toBe("refund");
    expect(lateCaptureAction({ ...swept, hasReferral: true })).toBe("refund");
    // A cancel by staff, or any other status, isn't a late capture.
    expect(lateCaptureAction({ ...swept, closeReason: "CUSTOMER_REQUEST" })).toBe("ignore");
    expect(lateCaptureAction({ ...swept, status: "PAID" })).toBe("ignore");
  });
});

describe("the unpaid sweep asks Razorpay before cancelling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "x";
    vi.doMock("@/server/payments", () => ({ fetchOrderPayments: h.fetchOrderPayments, markPaidFromSweep: h.markPaidFromSweep, razorpayClient: h.razorpayClient }));
    h.db.order.findMany.mockResolvedValue([{ id: "o1", couponCode: null, status: "PENDING_PAYMENT", paymentGateway: "RAZORPAY", paymentId: "order_rzp1", sessionId: "s1" }]);
    h.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ order: { updateMany: async () => ({ count: 1 }) } }));
  });
  const run = async () => {
    const { GET } = await import("@/app/api/cron/expire-unpaid/route");
    return (await GET(new Request("http://x/api/cron/expire-unpaid"))).json();
  };

  it("marks a paid order paid instead of cancelling it", async () => {
    h.fetchOrderPayments.mockResolvedValue([{ id: "pay_1", status: "captured", amount: 59900, method: "upi" }]);
    expect(await run()).toMatchObject({ closed: 0, paid: 1 });
    expect(h.markPaidFromSweep).toHaveBeenCalledWith(expect.objectContaining({ id: "o1" }), { id: "pay_1", amountPaise: 59900, method: "upi" });
    expect(h.releaseStock).not.toHaveBeenCalled();
  });

  it("leaves an authorized payment for the next run", async () => {
    h.fetchOrderPayments.mockResolvedValue([{ id: "pay_1", status: "authorized", amount: 59900, method: "card" }]);
    expect(await run()).toMatchObject({ closed: 0, waiting: 1 });
    expect(h.releaseStock).not.toHaveBeenCalled();
  });

  it("never cancels when Razorpay can't be asked", async () => {
    h.fetchOrderPayments.mockResolvedValue(null);
    expect(await run()).toMatchObject({ closed: 0, waiting: 1 });
    expect(h.releaseStock).not.toHaveBeenCalled();
  });

  it("cancels and releases stock when nothing was paid", async () => {
    h.fetchOrderPayments.mockResolvedValue([{ id: "pay_1", status: "failed", amount: 59900, method: "upi" }]);
    expect(await run()).toMatchObject({ closed: 1, paid: 0 });
    expect(h.releaseStock).toHaveBeenCalledTimes(1);
  });

  it("closes as before when Razorpay isn't set up (no online payment can exist)", async () => {
    h.razorpayClient.mockReturnValue(null);
    expect(await run()).toMatchObject({ closed: 1 });
    expect(h.fetchOrderPayments).not.toHaveBeenCalled();
  });
});

describe("a capture after the sweep closed the order", () => {
  const ORDER = { id: "o1", status: "CANCELLED", closeReason: "PAYMENT_NOT_COMPLETED", couponCode: "WELCOME10", sessionId: "s1", items: [{ batchId: "b1", quantity: 2, productNameSnapshot: "Biotin Glow Gummies" }] };
  const PAYMENT = { id: "pay_late", amountPaise: 109800, method: "upi" };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("@/server/payments");
    vi.doMock("razorpay", () => ({ default: class { payments = { refund: h.refund }; } }));
    vi.doMock("@/server/cart", () => ({ clearCart: vi.fn(async () => undefined) }));
    vi.doMock("@/lib/email", () => ({ sendOrderConfirmation: vi.fn(async () => ({ delivered: true })) }));
    vi.doMock("@/lib/analytics", () => ({ recordEvent: vi.fn() }));
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = "secret";
    h.db.order.findUnique.mockResolvedValue(ORDER);
    h.db.order.findUniqueOrThrow.mockResolvedValue({ ...ORDER, status: "PAID" });
    h.db.walletEntry.findFirst.mockResolvedValue(null);
    h.db.referral.findUnique.mockResolvedValue(null);
    h.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ order: { updateMany: async () => ({ count: 1 }) }, coupon: { updateMany: h.db.coupon.updateMany } }),
    );
  });

  it("puts the order back when its stock is still there, taking the same batches and the coupon use", async () => {
    const { handleLateCapture } = await import("@/server/payments");
    expect(await handleLateCapture("o1", PAYMENT)).toBe("reinstated");
    expect(h.takeStock).toHaveBeenCalledWith(expect.anything(), [{ id: "b1", qty: 2, name: "Biotin Glow Gummies" }]);
    expect(h.db.coupon.updateMany).toHaveBeenCalledWith({ where: { code: "WELCOME10" }, data: { usedCount: { increment: 1 } } });
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("refunds in full when the stock has gone since", async () => {
    h.takeStock.mockResolvedValueOnce("Biotin Glow Gummies");
    const { handleLateCapture } = await import("@/server/payments");
    expect(await handleLateCapture("o1", PAYMENT)).toBe("refunded");
    expect(h.refund).toHaveBeenCalledWith("pay_late", expect.objectContaining({ amount: 109800 }));
  });

  it("refunds rather than reinstating when wallet credit was given back at the cancel", async () => {
    h.db.walletEntry.findFirst.mockResolvedValue({ id: "w1" });
    const { handleLateCapture } = await import("@/server/payments");
    expect(await handleLateCapture("o1", PAYMENT)).toBe("refunded");
    expect(h.takeStock).not.toHaveBeenCalled();
  });

  it("flags the order for a person when the automatic refund fails", async () => {
    h.db.walletEntry.findFirst.mockResolvedValue({ id: "w1" });
    h.refund.mockRejectedValueOnce(new Error("gateway down"));
    const { handleLateCapture } = await import("@/server/payments");
    expect(await handleLateCapture("o1", PAYMENT)).toBe("refund-failed");
    expect(h.db.order.update).toHaveBeenCalledWith({ where: { id: "o1" }, data: { paymentStatus: "captured_after_cancel" } });
    expect(h.recordOrderEvent).toHaveBeenCalledWith("o1", "NOTE", { type: "SYSTEM" }, expect.objectContaining({ note: expect.stringContaining("Refund it from the Razorpay dashboard") }));
  });

  it("leaves alone an order that wasn't closed by the sweep", async () => {
    h.db.order.findUnique.mockResolvedValue({ ...ORDER, closeReason: "CUSTOMER_REQUEST" });
    const { handleLateCapture } = await import("@/server/payments");
    expect(await handleLateCapture("o1", PAYMENT)).toBe("ignored");
    expect(h.refund).not.toHaveBeenCalled();
  });
});
