/**
 * Demo data for the intelligence reports (docs/INTELLIGENCE.md). Called by
 * generateDemo (so a fresh demo has it) and by `npm run demo:intel` (to add
 * it to a demo database built before these reports). Demo database only.
 * Runs once: a second run finds its own pincode checks and changes nothing.
 *
 * What it does, keeping every order consistent with itself:
 * 1. Real shops see the same few pincodes again and again; the generator
 *    scattered orders across every pincode in a city's range. Each city's
 *    orders are gathered onto its busiest pincodes, one shopper at a time
 *    (all of a shopper's orders move together, so their address stays one
 *    address).
 * 2. Parcels that came back concentrate in two pincodes, as they do in life:
 *    shoppers with a return to origin move to them.
 * 3. Payment attempts get what the webhook would have recorded: a method on
 *    every failure, who caused it, retries before successful payments, and
 *    a card issuer having a bad day in the last 24 hours.
 * 4. Pincode checks at checkout, including demand from outside Gujarat, and
 *    payment windows closed without paying.
 * 5. An RTO risk score on every order, from the same rules checkout uses.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { scoreRtoRisk } from "../../src/lib/intel/rto-risk";
import { prng, DAY } from "./lib";

type Address = { name?: string; line1?: string; line2?: string | null; city?: string; state?: string; postalCode?: string; phone?: string };

const MINUTE = 60 * 1000;

/** Outside the delivery area: where checkout pincode checks come from. */
const OUTSIDE: readonly (readonly [string, number])[] = [
  ["4000", 30], ["4110", 14], ["1100", 14], ["5600", 12], ["3130", 9], ["4520", 8], ["7000", 7], ["6000", 6],
];

const CUSTOMER_FAILURES = ["Payment was cancelled by the customer", "UPI collect request expired", "Incorrect UPI PIN entered", "Insufficient balance"];
const BANK_FAILURES = ["Payment declined by bank", "Bank server is not responding", "Transaction declined by issuer"];

export async function seedIntel(db: PrismaClient, now = new Date()): Promise<{ skipped: boolean; moved: number; attempts: number; checks: number; scored: number }> {
  if ((await db.analyticsEvent.count({ where: { type: "PINCODE_CHECKED" } })) > 0) return { skipped: true, moved: 0, attempts: 0, checks: 0, scored: 0 };
  const r = prng(20260929);

  // A fresh demo is generated after the migrations ran, so their backfills
  // (pincode column, attempts from order timelines) found nothing: do them now.
  await db.$executeRawUnsafe(`UPDATE "Order" SET "postalCode" = "shippingAddress"->>'postalCode' WHERE "postalCode" IS NULL AND "shippingAddress" ? 'postalCode'`);
  await db.$executeRawUnsafe(`
    INSERT INTO "PaymentAttempt" ("id", "orderId", "razorpayOrderId", "razorpayPaymentId", "method", "status", "errorReason", "amountPaise", "createdAt")
    SELECT 'pa_' || e."id", e."orderId", COALESCE(o."paymentId", ''), e."detail"->>'razorpayPaymentId', e."detail"->>'method',
           CASE WHEN e."type" = 'PAYMENT_CAPTURED' THEN 'CAPTURED' ELSE 'FAILED' END, e."detail"->>'reason',
           NULLIF(e."detail"->>'amountPaise', '')::int, e."createdAt"
    FROM "OrderEvent" e JOIN "Order" o ON o."id" = e."orderId"
    WHERE e."type" IN ('PAYMENT_CAPTURED', 'PAYMENT_FAILED')
    ON CONFLICT DO NOTHING`);

  const orders = await db.order.findMany({
    select: {
      id: true, guestPhone: true, customerId: true, postalCode: true, shippingAddress: true, status: true, paymentGateway: true,
      placedAt: true, paymentId: true, totalAmount: true, sessionId: true, phoneVerifiedAt: true,
      items: { select: { productId: true, quantity: true } },
    },
    orderBy: { placedAt: "asc" },
  });
  const addr = (o: (typeof orders)[number]) => (o.shippingAddress ?? {}) as Address;

  /* 1 & 2: pincodes ----------------------------------------------------- */
  const byCity = new Map<string, Map<string, number>>();
  for (const o of orders) {
    const a = addr(o);
    if (!a.city || !a.postalCode) continue;
    const pins = byCity.get(a.city) ?? new Map<string, number>();
    pins.set(a.postalCode, (pins.get(a.postalCode) ?? 0) + 1);
    byCity.set(a.city, pins);
  }
  const busiest = new Map<string, string[]>();
  for (const [city, pins] of byCity) {
    const top = [...pins.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
    busiest.set(city, top.slice(0, Math.max(1, Math.min(5, Math.ceil(top.length / 4)))));
  }
  // Two pincodes where parcels keep coming back: the busiest in Surat and in Vadodara, if present.
  const hot = [busiest.get("Surat")?.[0], busiest.get("Vadodara")?.[0]].filter((p): p is string => Boolean(p));
  const hotCity = new Map(hot.map((p) => [p, [...byCity.entries()].find(([, pins]) => pins.has(p))![0]]));

  const shopperKey = (o: (typeof orders)[number]) => o.guestPhone ?? o.customerId ?? o.id;
  const refused = new Set(orders.filter((o) => o.status === "RTO").map(shopperKey));
  const target = new Map<string, { pin: string; city: string }>();
  for (const o of orders) {
    const key = shopperKey(o);
    if (target.has(key)) continue;
    const a = addr(o);
    if (!a.city) continue;
    if (refused.has(key) && hot.length && r.chance(0.75)) {
      const pin = r.pick(hot);
      target.set(key, { pin, city: hotCity.get(pin)! });
    } else {
      const list = busiest.get(a.city) ?? [a.postalCode ?? ""];
      target.set(key, { pin: r.weighted(list.map((p, i) => [p, list.length - i] as const)), city: a.city });
    }
  }
  let moved = 0;
  for (const o of orders) {
    const t = target.get(shopperKey(o));
    const a = addr(o);
    if (!t || (a.postalCode === t.pin && a.city === t.city)) continue;
    const next = { ...a, postalCode: t.pin, city: t.city } as Prisma.InputJsonValue;
    await db.order.update({ where: { id: o.id }, data: { postalCode: t.pin, shippingAddress: next, billingAddress: next } });
    o.postalCode = t.pin;
    o.shippingAddress = next as Prisma.JsonValue;
    moved += 1;
  }

  /* 3: payment attempts --------------------------------------------------- */
  const attempts: Prisma.PaymentAttemptCreateManyInput[] = [];
  const online = orders.filter((o) => o.paymentGateway === "RAZORPAY" && o.paymentId);
  const captured = await db.paymentAttempt.findMany({ where: { status: "CAPTURED" }, select: { orderId: true, method: true, createdAt: true } });
  const methodOf = new Map(captured.map((c) => [c.orderId, c.method]));
  for (const o of online) {
    const method = methodOf.get(o.id) ?? r.weighted([["upi", 70], ["card", 22], ["netbanking", 8]] as const);
    // A retry before a successful payment: most are the shopper's own doing.
    if (methodOf.has(o.id) && r.chance(0.16)) {
      const byShopper = r.chance(0.65);
      attempts.push({
        orderId: o.id, razorpayOrderId: o.paymentId!, razorpayPaymentId: `pay_demo_${r.token(12)}`, method, status: "FAILED",
        errorSource: byShopper ? "customer" : "bank", errorReason: r.pick(byShopper ? CUSTOMER_FAILURES : BANK_FAILURES),
        amountPaise: Math.round(Number(o.totalAmount) * 100), createdAt: new Date(o.placedAt.getTime() + 20_000),
      });
    }
  }
  // Failures already recorded without a method (from before the webhook kept it).
  const unlabelled = await db.paymentAttempt.findMany({ where: { status: "FAILED", method: null }, select: { id: true } });
  for (const u of unlabelled) {
    await db.paymentAttempt.update({ where: { id: u.id }, data: { method: r.weighted([["upi", 70], ["card", 30]] as const), errorSource: r.chance(0.5) ? "bank" : "customer" } });
  }
  // A card issuer's bad day: bank-side card failures over the last 20 hours,
  // spaced out (so it reads as degraded, not a hard outage).
  for (let i = 0; i < 12; i++) {
    attempts.push({
      orderId: null, razorpayOrderId: `order_demo_${r.token(12)}`, razorpayPaymentId: `pay_demo_${r.token(12)}`, method: "card", status: "FAILED",
      errorSource: "bank", errorReason: "Card issuer is not responding", amountPaise: r.int(399, 1499) * 100,
      createdAt: new Date(now.getTime() - (i * 95 + r.int(5, 40)) * MINUTE),
    });
  }
  for (let i = 0; i < 18; i++) {
    attempts.push({
      orderId: null, razorpayOrderId: `order_demo_${r.token(12)}`, razorpayPaymentId: `pay_demo_${r.token(12)}`, method: "card", status: "CAPTURED",
      errorSource: null, errorReason: null, amountPaise: r.int(399, 1499) * 100, createdAt: new Date(now.getTime() - (i * 70 + r.int(1, 50)) * MINUTE),
    });
  }
  if (attempts.length) await db.paymentAttempt.createMany({ data: attempts, skipDuplicates: true });

  /* 4: pincode checks and closed payment windows --------------------------- */
  const events: Prisma.AnalyticsEventCreateManyInput[] = [];
  for (const o of orders) {
    if (!o.sessionId || !o.postalCode) continue;
    events.push({ sessionId: o.sessionId, type: "PINCODE_CHECKED", metadata: { pincode: o.postalCode, serviceable: true }, createdAt: new Date(o.placedAt.getTime() - 3 * MINUTE) });
    if (o.paymentGateway === "RAZORPAY" && (o.status === "FAILED" || r.chance(0.08))) {
      events.push({ sessionId: o.sessionId, type: "PAYMENT_DISMISSED", metadata: { method: r.chance(0.7) ? "UPI" : "CARD" }, createdAt: new Date(o.placedAt.getTime() + 2 * MINUTE) });
    }
  }
  const first = orders[0]?.placedAt ?? new Date(now.getTime() - 90 * DAY);
  const span = now.getTime() - first.getTime();
  for (let i = 0; i < 160; i++) {
    const prefix = r.weighted(OUTSIDE);
    events.push({
      sessionId: `demo-${r.token(16)}`,
      type: "PINCODE_CHECKED",
      metadata: { pincode: `${prefix}${String(r.int(1, 99)).padStart(2, "0")}`, serviceable: false },
      createdAt: new Date(first.getTime() + r.next() * span),
    });
  }
  await db.analyticsEvent.createMany({ data: events });

  /* 5: risk scores ----------------------------------------------------------- */
  const finished = orders.filter((o) => o.paymentGateway === "COD" && ["DELIVERED", "RTO", "RETURNED"].includes(o.status));
  const storeRate = finished.length ? finished.filter((o) => o.status === "RTO").length / finished.length : 0;
  let scored = 0;
  for (const o of orders) {
    const earlier = orders.filter((x) => x.placedAt < o.placedAt && ((o.guestPhone && x.guestPhone === o.guestPhone) || (o.customerId && x.customerId === o.customerId)));
    const pinFinished = finished.filter((x) => x.postalCode === o.postalCode && x.id !== o.id);
    const perProduct = new Map<string, number>();
    for (const i of o.items) perProduct.set(i.productId, (perProduct.get(i.productId) ?? 0) + i.quantity);
    const a = addr(o);
    const result = scoreRtoRisk({
      cod: o.paymentGateway === "COD",
      totalPaise: Math.round(Number(o.totalAmount) * 100),
      units: o.items.reduce((s, i) => s + i.quantity, 0),
      maxUnitsOfOneProduct: Math.max(0, ...perProduct.values()),
      placedAt: o.placedAt,
      phoneVerified: Boolean(o.phoneVerifiedAt),
      priorDelivered: earlier.filter((x) => x.status === "DELIVERED").length,
      priorReturnedToOrigin: earlier.filter((x) => x.status === "RTO").length,
      priorPrepaidDelivered: earlier.filter((x) => x.status === "DELIVERED" && x.paymentGateway !== "COD").length,
      recentOpenCod: earlier.filter((x) => x.paymentGateway === "COD" && ["PROCESSING", "PAID"].includes(x.status) && o.placedAt.getTime() - x.placedAt.getTime() <= DAY).length,
      pincode: o.postalCode ? { codFinished: pinFinished.length, codReturned: pinFinished.filter((x) => x.status === "RTO").length } : null,
      storeCodRtoRate: storeRate,
      address: [a.line1, a.line2].filter(Boolean).join(", "),
    });
    await db.order.update({ where: { id: o.id }, data: { riskScore: result.score, riskReasons: result.reasons as unknown as Prisma.InputJsonValue } });
    scored += 1;
  }

  return { skipped: false, moved, attempts: attempts.length, checks: events.filter((e) => e.type === "PINCODE_CHECKED").length, scored };
}
