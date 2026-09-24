/**
 * Checkout load test: how long placing an order takes, alone and with many
 * shoppers at once. Places real cash-on-delivery orders for the E2E test
 * product against a running server, then deletes them and restores stock.
 *
 *   npx next build && npx next start -p 3100     (in another terminal)
 *   npm run perf:checkout                        (SHOPPERS=20 BASE=http://localhost:3100)
 *
 * Refuses a non-local server unless LOAD_ALLOW_REMOTE=1: it writes orders.
 * Needs the E2E product (created by `npm run test:e2e`).
 */
import { config } from "dotenv";
import pg from "pg";
import { randomUUID } from "node:crypto";

config({ path: ".env.local" });
config();

const BASE = process.env.BASE ?? "http://localhost:3100";
const SHOPPERS = Number(process.env.SHOPPERS ?? 20);
const SINGLE_RUNS = 3;
const TAG = "load-test@soulone.test";

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && process.env.LOAD_ALLOW_REMOTE !== "1") {
  console.error(`Refusing to place test orders on ${BASE}. Set LOAD_ALLOW_REMOTE=1 if you really mean it.`);
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 30000 });
await db.connect();

const product = (await db.query(`SELECT id, "basePrice" FROM "Product" WHERE slug='e2e-test-product'`)).rows[0];
if (!product) {
  console.error("The E2E test product doesn't exist yet. Run `npm run test:e2e` once to create it.");
  process.exit(1);
}
const batches = (await db.query(`SELECT id, "quantityRemaining" FROM "ProductBatch" WHERE "productId"=$1`, [product.id])).rows;
const sessions: string[] = [];

async function basket(): Promise<string> {
  const sid = randomUUID();
  sessions.push(sid);
  const cartId = "load" + sid.replace(/-/g, "").slice(0, 20);
  await db.query(`INSERT INTO "Cart" (id,"sessionId","updatedAt") VALUES ($1,$2,now())`, [cartId, sid]);
  await db.query(`INSERT INTO "CartItem" (id,"cartId","productId",quantity,"priceAtAdd") VALUES ($1,$2,$3,1,$4)`, [cartId + "i", cartId, product.id, product.basePrice]);
  return sid;
}

async function placeOrder(sid: string, i: number): Promise<{ ms: number; status: number; message?: string }> {
  const started = performance.now();
  const res = await fetch(BASE + "/api/checkout/create-order", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `soulone_cart=${sid}` },
    body: JSON.stringify({
      name: "Load Test",
      email: TAG,
      phone: "98" + String(10000000 + i).slice(-8),
      line1: "1 Load Lane",
      city: "Ahmedabad",
      state: "Gujarat",
      postalCode: "380015",
      paymentMethod: "COD",
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ms: performance.now() - started, status: res.status, message: res.ok ? undefined : body.message };
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const s = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

try {
  // Warm-up, not counted: first request compiles routes and opens pooled connections.
  await placeOrder(await basket(), 0);

  const single: number[] = [];
  for (let i = 1; i <= SINGLE_RUNS; i++) single.push((await placeOrder(await basket(), i)).ms);
  single.sort((a, b) => a - b);

  const sids = await Promise.all(Array.from({ length: SHOPPERS }, () => basket()));
  const wall = performance.now();
  const results = await Promise.all(sids.map((sid, i) => placeOrder(sid, 100 + i)));
  const wallMs = performance.now() - wall;
  const ok = results.filter((r) => r.status === 200).map((r) => r.ms).sort((a, b) => a - b);
  const failed = results.filter((r) => r.status !== 200);

  console.log(`Server: ${BASE}`);
  console.log(`One shopper at a time (${SINGLE_RUNS} orders): median ${s(pct(single, 50))}, worst ${s(single[single.length - 1])}`);
  console.log(
    `${SHOPPERS} shoppers at once: ${ok.length} placed, ${failed.length} failed, all done in ${s(wallMs)}` +
      (ok.length ? ` | median ${s(pct(ok, 50))}, p95 ${s(pct(ok, 95))}, worst ${s(ok[ok.length - 1])}` : ""),
  );
  for (const f of failed.slice(0, 5)) console.log(`  failed: ${f.status} ${f.message ?? ""}`);
} finally {
  await db.query(`DELETE FROM "Order" WHERE "guestEmail"=$1`, [TAG]);
  await db.query(`DELETE FROM "Cart" WHERE "sessionId" = ANY($1)`, [sessions]);
  await db.query(`DELETE FROM "AnalyticsEvent" WHERE "sessionId" = ANY($1)`, [sessions]);
  for (const b of batches) await db.query(`UPDATE "ProductBatch" SET "quantityRemaining"=$1 WHERE id=$2`, [b.quantityRemaining, b.id]);
  // The product total follows the batches by trigger; nothing to restore directly.
  await db.end();
}
