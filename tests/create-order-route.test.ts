import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route tests for POST /api/checkout/create-order (audit H5): every decision
 * the route makes, with the database, basket, stock and gateway replaced by
 * fakes. The pricing, shelf-life and stock rules themselves have their own
 * tests; this checks the route applies them in the right order and never
 * reserves anything it shouldn't.
 */

const h = vi.hoisted(() => {
  const tx = {
    order: { create: vi.fn() },
    orderItem: { createMany: vi.fn() },
    cartItem: { deleteMany: vi.fn() },
    coupon: { updateMany: vi.fn() },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      coupon: { fields: { maxUses: "maxUses" } },
      order: { update: vi.fn() },
      consentRecord: { create: vi.fn(async () => ({})) },
    },
    limitPublic: vi.fn(),
    readSessionId: vi.fn(),
    quoteCart: vi.fn(),
    writeBasketCount: vi.fn(),
    takeStock: vi.fn(),
    lookupPincode: vi.fn(),
    getCheckoutState: vi.fn(),
    sendOrderConfirmation: vi.fn(async () => ({ delivered: true })),
    recordEvent: vi.fn(),
    recordOrderEvent: vi.fn(),
    expireTag: vi.fn(),
    razorpayCreate: vi.fn(),
    afterCallbacks: [] as (() => Promise<unknown>)[],
  };
});

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown>) => h.afterCallbacks.push(fn),
}));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/server/rate-limit", () => ({ limitPublic: h.limitPublic }));
vi.mock("@/server/cart", () => ({
  readSessionId: h.readSessionId,
  quoteCart: h.quoteCart,
  writeBasketCount: h.writeBasketCount,
}));
vi.mock("@/server/order-stock", () => ({ takeStock: h.takeStock }));
vi.mock("@/server/pincode", () => ({ lookupPincode: h.lookupPincode }));
vi.mock("@/server/store-settings", () => ({ getCheckoutState: h.getCheckoutState }));
vi.mock("@/lib/email", () => ({ sendOrderConfirmation: h.sendOrderConfirmation }));
vi.mock("@/lib/analytics", () => ({ recordEvent: h.recordEvent }));
vi.mock("@/lib/order-events", () => ({ recordOrderEvent: h.recordOrderEvent }));
vi.mock("@/lib/cache-tags", () => ({ CATALOG_TAG: "catalog", expireTag: h.expireTag }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("razorpay", () => ({
  default: class {
    orders = { create: h.razorpayCreate };
  },
}));

import { POST } from "../src/app/api/checkout/create-order/route";

const INPUT = {
  email: "shopper@example.in",
  phone: "9876543210",
  name: "Asha Patel",
  line1: "12 Relief Road",
  city: "Ahmedabad",
  state: "Gujarat",
  postalCode: "380001",
  paymentMethod: "COD",
};

/** A two-unit basket of one product, drawn from two batches. */
function quoteResult(overrides: Record<string, unknown> = {}) {
  return {
    quote: {
      canProceed: true,
      lines: [
        {
          productId: "p1",
          variantId: undefined,
          name: "Masala Makhana",
          status: "OK",
          quantityAvailable: 2,
          grossPaise: 39800,
          listGrossPaise: 39800,
          taxablePaise: 37905,
          taxPaise: 1895,
          taxRatePercent: 5,
          allocations: [
            { batchId: "b1", quantity: 1 },
            { batchId: "b2", quantity: 1 },
          ],
        },
      ],
      subtotalPaise: 39800,
      productDiscountPaise: 0,
      bundleDiscountPaise: 0,
      appliedBundles: [],
      discountPaise: 0,
      shippingPaise: 5900,
      taxPaise: 2176,
      totalPaise: 45700,
      appliedCouponCode: undefined,
      ...overrides,
    },
    cartItems: [{ productId: "p1", product: { hsnCode: "2008" } }],
    estimatedDeliveryDate: new Date("2026-10-01"),
    gstTreatment: "INTRA_STATE",
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/checkout/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.afterCallbacks.length = 0;
  h.limitPublic.mockResolvedValue(null);
  h.readSessionId.mockResolvedValue("session-1");
  h.getCheckoutState.mockResolvedValue({ open: true, methods: ["COD", "ONLINE"] });
  h.lookupPincode.mockResolvedValue({ city: "Ahmedabad", state: "Gujarat" });
  h.quoteCart.mockResolvedValue(quoteResult());
  h.takeStock.mockResolvedValue(null);
  h.tx.coupon.updateMany.mockResolvedValue({ count: 1 });
  h.tx.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "order-1",
    ...data,
  }));
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
});

describe("refusals before anything is reserved", () => {
  it("returns the rate limiter's answer untouched", async () => {
    const tooMany = new Response(null, { status: 429 });
    h.limitPublic.mockResolvedValue(tooMany);
    expect(await post(INPUT)).toBe(tooMany);
    expect(h.quoteCart).not.toHaveBeenCalled();
  });

  it("needs a basket session", async () => {
    h.readSessionId.mockResolvedValue(null);
    const res = await post(INPUT);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Your basket is empty.");
  });

  it("names the fields that failed validation", async () => {
    const res = await post({ ...INPUT, phone: "12345" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues.map((i: { path: string[] }) => i.path[0])).toContain("phone");
  });

  it("honours the owner's pause, with their message", async () => {
    h.getCheckoutState.mockResolvedValue({ open: false, message: "Back on Monday.", methods: [] });
    const res = await post(INPUT);
    expect(res.status).toBe(503);
    expect((await res.json()).message).toBe("Back on Monday.");
  });

  it("refuses a payment method that's switched off", async () => {
    h.getCheckoutState.mockResolvedValue({ open: true, methods: ["ONLINE"] });
    const res = await post(INPUT);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/Cash on delivery isn't available/);
  });

  it("refuses an address outside Gujarat, by India Post's state not the typed one", async () => {
    h.lookupPincode.mockResolvedValue({ city: "Mumbai", state: "Maharashtra" });
    const res = await post({ ...INPUT, postalCode: "400001" });
    expect(res.status).toBe(400);
    expect((await res.json()).issues[0].path).toEqual(["postalCode"]);
    expect(h.quoteCart).not.toHaveBeenCalled();
  });

  it("stops on a blocked line and says which one", async () => {
    const result = quoteResult({ canProceed: false });
    (result.quote.lines[0] as Record<string, unknown>).status = "BLOCKED";
    (result.quote.lines[0] as Record<string, unknown>).customerMessage = "No longer available.";
    h.quoteCart.mockResolvedValue(result);
    const res = await post(INPUT);
    expect(res.status).toBe(409);
    expect((await res.json()).blocked).toEqual([{ name: "Masala Makhana", reason: "No longer available." }]);
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });
});

describe("cash on delivery", () => {
  it("stores the server's quote, one item row per batch, and empties the basket", async () => {
    const res = await post(INPUT);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("COD");
    expect(body.orderNumber).toBeTruthy();
    expect(body.accessToken).toBeTruthy();

    const order = h.tx.order.create.mock.calls[0][0].data;
    expect(order.status).toBe("PROCESSING");
    expect(order.paymentStatus).toBe("COD_PENDING");
    expect(order.totalAmount).toBe("457.00");
    expect(order.shippingTaxAmount).toBe("2.81"); // total tax 21.76 less the lines' 18.95
    expect(order.gstTreatment).toBe("INTRA_STATE");

    const rows = h.tx.orderItem.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { batchId: string }) => r.batchId)).toEqual(["b1", "b2"]);
    expect(rows.every((r: { orderId: string; hsnCode: string }) => r.orderId === "order-1" && r.hsnCode === "2008")).toBe(true);

    expect(h.tx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cart: { sessionId: "session-1" } } });
    expect(h.takeStock).toHaveBeenCalledWith(h.tx, [
      { id: "b1", qty: 1, name: "Masala Makhana" },
      { id: "b2", qty: 1, name: "Masala Makhana" },
    ]);
    expect(h.writeBasketCount).toHaveBeenCalledWith(0);
    expect(h.expireTag).toHaveBeenCalledWith("catalog");
  });

  it("sends the confirmation after the response, and records consent only when ticked", async () => {
    await post({ ...INPUT, marketingConsent: true });
    expect(h.sendOrderConfirmation).not.toHaveBeenCalled();
    for (const fn of h.afterCallbacks) await fn();
    expect(h.sendOrderConfirmation).toHaveBeenCalledTimes(1);
    expect(h.db.consentRecord.create).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    h.afterCallbacks.length = 0;
    await post(INPUT);
    for (const fn of h.afterCallbacks) await fn();
    expect(h.db.consentRecord.create).not.toHaveBeenCalled();
  });

  it("answers 'just sold out' when another checkout took the stock", async () => {
    h.takeStock.mockResolvedValue("Masala Makhana");
    const res = await post(INPUT);
    expect(res.status).toBe(409);
    expect((await res.json()).blocked[0].reason).toBe("Just sold out while you were checking out.");
    expect(h.writeBasketCount).not.toHaveBeenCalled();
  });

  it("answers 'used up' when the code's last use went in the meantime", async () => {
    h.quoteCart.mockResolvedValue(quoteResult({ appliedCouponCode: "WELCOME10" }));
    h.tx.coupon.updateMany.mockResolvedValue({ count: 0 });
    const res = await post({ ...INPUT, couponCode: "WELCOME10" });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/just been used up/);
    expect(h.takeStock).not.toHaveBeenCalled();
  });

  it("lets a real database error through rather than hiding it", async () => {
    h.db.$transaction.mockRejectedValueOnce(new Error("connection reset"));
    await expect(post(INPUT)).rejects.toThrow("connection reset");
  });
});

describe("online payment", () => {
  const ONLINE = { ...INPUT, paymentMethod: "RAZORPAY" };

  it("waits for the webhook and keeps the basket", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = "secret";
    h.razorpayCreate.mockResolvedValue({ id: "order_RZP1" });

    const res = await post(ONLINE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ method: "RAZORPAY", razorpayOrderId: "order_RZP1", amount: 45700, keyId: "rzp_test_x" });

    expect(h.tx.order.create.mock.calls[0][0].data.status).toBe("PENDING_PAYMENT");
    expect(h.tx.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(h.razorpayCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 45700, currency: "INR" }));
    expect(h.db.order.update).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { paymentId: "order_RZP1" } });

    for (const fn of h.afterCallbacks) await fn();
    expect(h.sendOrderConfirmation).not.toHaveBeenCalled(); // the webhook sends it once paid
  });

  it("says precisely when the gateway isn't configured", async () => {
    const res = await post(ONLINE);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.message).toMatch(/RAZORPAY_KEY_ID/);
    expect(body.orderNumber).toBeTruthy();
  });
});
