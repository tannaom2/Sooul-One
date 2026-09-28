/**
 * Shared fixtures for the QA suite (tests/qa). DEMO DATABASE ONLY.
 *
 * Every database write goes through demoClient (scripts/demo/lib.ts), which
 * asks Postgres which database it is connected to and refuses anything not
 * named *_demo. The HTTP side talks to the demo server on :3000, and
 * global-setup checks that server really is the demo (it can see a product
 * that exists only in the demo database) before any test runs.
 *
 * Virtual shoppers are real Customer rows with real sessions: a random token
 * whose SHA-256 is stored, exactly as sign-in does (src/server/customer-auth.ts),
 * so requests carry a genuine signed-in cookie. Everything the suite creates is
 * tagged "qa-" / @qa.example.test and removed by cleanup().
 */
import { config } from "dotenv";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { demoClient, demoUrls } from "../../scripts/demo/lib";

export const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
export const QA_EMAIL_DOMAIN = "qa.example.test";
export const QA_PHONE_PREFIX = "91199"; // 91199xxxxx: never a real shopper in the demo data
export const PRODUCTS = {
  lastUnit: { slug: "qa-last-unit", sku: "QA-LAST-UNIT", price: 299 },
  plenty: { slug: "qa-plenty", sku: "QA-PLENTY", price: 450 },
} as const;
export const SINGLE_USE_COUPON = "QAONCE";

let client: PrismaClient | null = null;

/** The demo database, and only the demo database. */
export async function demo(): Promise<PrismaClient> {
  if (client) return client;
  config({ path: ".env.local", quiet: true });
  client = await demoClient(demoUrls().pooled);
  return client;
}

export async function closeDemo() {
  await client?.$disconnect();
  client = null;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export interface VirtualShopper {
  readonly customerId: string;
  readonly phone: string;
  readonly name: string;
  /** Raw value of the soulone_customer cookie. */
  readonly token: string;
}

/** A signed-in shopper: a Customer with a phone proven, and a live session. */
export async function shopper(n: number, name = `QA Shopper ${n}`): Promise<VirtualShopper> {
  const db = await demo();
  const phone = `${QA_PHONE_PREFIX}${String(n).padStart(5, "0")}`;
  const customer = await db.customer.upsert({
    where: { phone },
    create: { phone, name, phoneVerifiedAt: new Date() },
    update: { name },
  });
  const token = randomBytes(32).toString("base64url");
  await db.customerSession.create({
    data: { customerId: customer.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000), userAgent: "qa-suite" },
  });
  return { customerId: customer.id, phone, name, token };
}

/** A basket (guest session) holding these products; returns the session id for the soulone_cart cookie. */
export async function basket(items: { slug: string; quantity: number }[]): Promise<string> {
  const db = await demo();
  const sessionId = `qa-${randomUUID()}`;
  const products = await db.product.findMany({ where: { slug: { in: items.map((i) => i.slug) } } });
  await db.cart.create({
    data: {
      sessionId,
      items: {
        create: items.map((i) => {
          const p = products.find((x) => x.slug === i.slug);
          if (!p) throw new Error(`QA product ${i.slug} missing: run global setup`);
          return { productId: p.id, quantity: i.quantity, priceAtAdd: p.basePrice };
        }),
      },
    },
  });
  return sessionId;
}

/** Cookie header for a request as this shopper with this basket. */
export function cookies(sessionId: string, who?: VirtualShopper): string {
  return [`soulone_cart=${sessionId}`, who ? `soulone_customer=${who.token}` : null].filter(Boolean).join("; ");
}

/**
 * A distinct client address per virtual user, sent as CF-Connecting-IP.
 * Locally there's no Cloudflare, so the app reads it as given; on Render,
 * Cloudflare overwrites it. Without this, N users from one machine share one
 * rate-limit bucket.
 */
export function ipFor(n: number): string {
  return `10.99.${Math.floor(n / 250)}.${(n % 250) + 1}`;
}

export function orderBody(who: VirtualShopper, over: Record<string, unknown> = {}) {
  return {
    phone: who.phone,
    email: `${who.phone}@${QA_EMAIL_DOMAIN}`,
    name: who.name,
    line1: "QA House, 1 Test Road",
    city: "Ahmedabad",
    state: "Gujarat",
    postalCode: "380009",
    paymentMethod: "COD",
    ...over,
  };
}

export async function placeOrder(sessionId: string, who: VirtualShopper, n: number, over: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(`${BASE}/api/checkout/create-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies(sessionId, who), "CF-Connecting-IP": ipFor(n), ...extraHeaders },
    body: JSON.stringify(orderBody(who, over)),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Remove everything the suite created (orders first: their items point at QA batches). */
export async function cleanup(): Promise<void> {
  const db = await demo();
  const customers = await db.customer.findMany({ where: { phone: { startsWith: QA_PHONE_PREFIX } }, select: { id: true } });
  const ids = customers.map((c) => c.id);
  const qaProducts = await db.product.findMany({ where: { slug: { startsWith: "qa-" } }, select: { id: true } });
  const orders = await db.order.findMany({
    where: { OR: [{ guestEmail: { endsWith: `@${QA_EMAIL_DOMAIN}` } }, { customerId: { in: ids } }, { items: { some: { productId: { in: qaProducts.map((p) => p.id) } } } }] },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  await db.walletEntry.deleteMany({ where: { OR: [{ customerId: { in: ids } }, { orderId: { in: orderIds } }] } });
  await db.referral.deleteMany({ where: { OR: [{ refereeId: { in: ids } }, { referrerId: { in: ids } }] } });
  await db.referralCode.deleteMany({ where: { customerId: { in: ids } } });
  await db.consentRecord.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.analyticsEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.cart.deleteMany({ where: { sessionId: { startsWith: "qa-" } } });
  await db.customerSession.deleteMany({ where: { customerId: { in: ids } } });
  await db.phoneOtp.deleteMany({ where: { phone: { startsWith: QA_PHONE_PREFIX } } });
  await db.customer.deleteMany({ where: { id: { in: ids } } });
  await db.coupon.deleteMany({ where: { code: { startsWith: "QA" } } });
  await db.product.deleteMany({ where: { slug: { startsWith: "qa-" } } });
  await db.rateLimit.deleteMany({ where: { key: { contains: "10.99." } } });
}

/** Words that must never reach a shopper's screen: unbound values and template debris. */
export const LEAK_PATTERN = /\b(undefined|NaN)\b|\bnull\b|\[object Object\]|lorem ipsum|\{\{|\$\{|â‚¹|Â/i;
