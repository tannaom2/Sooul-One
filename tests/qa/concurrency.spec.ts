/**
 * N-user concurrency: real HTTP requests fired at the same moment against the
 * demo server, each from its own signed-in shopper, basket and address.
 * The assertions are about money and stock: nothing oversold, no code used
 * twice, no credit spent twice, and no order placed twice.
 */
import { expect, test } from "@playwright/test";
import { PRODUCTS, SINGLE_USE_COUPON, basket, closeDemo, demo, placeOrder, shopper } from "./fixtures";

const N = Number(process.env.QA_USERS ?? 12);

test.afterAll(closeDemo);

test("QA-CONC-01: N shoppers race for the last unit: exactly one order, stock never negative", async () => {
  const shoppers = await Promise.all(Array.from({ length: N }, (_, i) => shopper(100 + i)));
  const baskets = await Promise.all(shoppers.map(() => basket([{ slug: PRODUCTS.lastUnit.slug, quantity: 1 }])));

  const results = await Promise.all(shoppers.map((s, i) => placeOrder(baskets[i], s, 100 + i)));
  const placed = results.filter((r) => r.status === 200);
  const refused = results.filter((r) => r.status === 409);

  expect(placed, "exactly one shopper gets the last unit").toHaveLength(1);
  expect(refused.length, "everyone else is told it sold out").toBe(N - 1);
  for (const r of refused) expect(JSON.stringify(r.body)).toMatch(/sold out|can't be sent/i);

  const db = await demo();
  const product = await db.product.findUniqueOrThrow({ where: { slug: PRODUCTS.lastUnit.slug }, include: { batches: true } });
  expect(product.batches[0].quantityRemaining).toBe(0);
  expect(product.stockQuantity).toBe(0);
  expect(await db.orderItem.aggregate({ where: { productId: product.id }, _sum: { quantity: true } })).toEqual({ _sum: { quantity: 1 } });
});

test("QA-CONC-02: N shoppers redeem a single-use code at once: it discounts exactly one order", async () => {
  const shoppers = await Promise.all(Array.from({ length: N }, (_, i) => shopper(200 + i)));
  const baskets = await Promise.all(shoppers.map(() => basket([{ slug: PRODUCTS.plenty.slug, quantity: 1 }])));

  const results = await Promise.all(shoppers.map((s, i) => placeOrder(baskets[i], s, 200 + i, { couponCode: SINGLE_USE_COUPON })));

  const db = await demo();
  const coupon = await db.coupon.findUniqueOrThrow({ where: { code: SINGLE_USE_COUPON } });
  const withCode = await db.order.count({ where: { couponCode: SINGLE_USE_COUPON } });
  expect(coupon.usedCount, "the code's use count never passes its limit").toBe(1);
  expect(withCode, "exactly one order carries the code").toBe(1);

  // Everyone who didn't get the code must NOT have been charged a price they never saw:
  // an order placed without the code they asked for is a pricing-integrity failure.
  const placedWithoutCode = await db.order.count({
    where: { guestPhone: { in: shoppers.map((s) => s.phone) }, couponCode: null },
  });
  test.info().annotations.push({ type: "placed-without-requested-code", description: String(placedWithoutCode) });
  expect(placedWithoutCode, "orders silently placed at full price after asking for a code").toBe(0);
  expect(results.filter((r) => r.status === 200)).toHaveLength(1);
});

test("QA-CONC-03: one wallet, two checkouts at once: the ₹100 credit is spent once", async () => {
  const db = await demo();
  const who = await shopper(300, "QA Wallet Owner");
  await db.referralProgram.upsert({ where: { id: "default" }, update: { isActive: true }, create: { id: "default", isActive: true } });
  await db.walletEntry.create({
    data: { customerId: who.customerId, amount: "100", kind: "ADJUSTMENT", expiresAt: new Date(Date.now() + 90 * 86_400_000), note: "QA credit" },
  });
  // Two baskets over the ₹799 minimum, checked out at the same moment by the same person.
  const [b1, b2] = await Promise.all([basket([{ slug: PRODUCTS.plenty.slug, quantity: 2 }]), basket([{ slug: PRODUCTS.plenty.slug, quantity: 2 }])]);
  const results = await Promise.all([placeOrder(b1, who, 301), placeOrder(b2, who, 302)]);

  const orders = await db.order.findMany({ where: { customerId: who.customerId }, select: { creditAmount: true } });
  const creditUsed = orders.reduce((n, o) => n + Number(o.creditAmount), 0);
  expect(creditUsed, "credit spent across both orders").toBe(100);
  const ledger = await db.walletEntry.aggregate({ where: { customerId: who.customerId }, _sum: { amount: true } });
  expect(Number(ledger._sum.amount ?? 0), "wallet never goes below zero").toBeGreaterThanOrEqual(0);
  // The loser is either told the credit changed (409) or placed without credit; never both with credit.
  expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
});

test("QA-CONC-04: a double-clicked Place order (two identical requests at once) makes one order", async () => {
  const db = await demo();

  // As the browser sends it: the same checkout-attempt key on both clicks.
  const who = await shopper(400, "QA Double Click");
  const sessionId = await basket([{ slug: PRODUCTS.plenty.slug, quantity: 1 }]);
  const key = crypto.randomUUID();
  const keyed = await Promise.all([
    placeOrder(sessionId, who, 401, {}, { "Idempotency-Key": key }),
    placeOrder(sessionId, who, 401, {}, { "Idempotency-Key": key }),
  ]);
  expect(await db.order.count({ where: { customerId: who.customerId } }), "orders from one double click").toBe(1);
  expect(keyed.every((r) => r.status === 200), "both clicks get an answer").toBe(true);
  expect(keyed[0].body.orderNumber, "and it's the same order").toBe(keyed[1].body.orderNumber);

  // A raw repeat with no key (an old tab, a script): the basket lock still allows one.
  const who2 = await shopper(402, "QA Double Post");
  const session2 = await basket([{ slug: PRODUCTS.plenty.slug, quantity: 1 }]);
  const raw = await Promise.all([placeOrder(session2, who2, 403), placeOrder(session2, who2, 403)]);
  test.info().annotations.push({ type: "unkeyed statuses", description: raw.map((r) => r.status).join(",") });
  expect(await db.order.count({ where: { customerId: who2.customerId } }), "orders from two unkeyed posts").toBe(1);
});
