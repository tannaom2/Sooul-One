/**
 * Shared pieces of the demo toolkit (docs/DEMO.md).
 *
 * The demo runs against its own database, `sooulone_demo`, created next to the
 * real one on the same Postgres server and dropped afterwards. Nothing here
 * ever writes to the real database: every write path first proves, by asking
 * Postgres, that it is connected to a database whose name ends in "_demo".
 */
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export const DEMO_DATABASE = "sooulone_demo";

/** Refuses any name that isn't unmistakably a demo database. */
export function assertDemoName(name: string): void {
  if (!/^[a-z0-9_]+_demo$/.test(name)) {
    throw new Error(`Refusing to touch database "${name}": demo tooling only works on databases named *_demo.`);
  }
}

/** The same connection string, pointed at another database on the same server. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** The real app's connection strings, from .env.local. Read-only use here. */
export function mainUrls(): { pooled: string; direct: string } {
  const pooled = process.env.DATABASE_URL;
  if (!pooled) throw new Error("DATABASE_URL isn't set. Run from the project folder, where .env.local lives.");
  const direct = process.env.DIRECT_URL || pooled;
  if (databaseOf(pooled).endsWith("_demo")) {
    throw new Error("DATABASE_URL already points at a demo database. Point it back at the real one in .env.local.");
  }
  return { pooled, direct };
}

export function demoUrls(): { pooled: string; direct: string } {
  const { pooled, direct } = mainUrls();
  return { pooled: withDatabase(pooled, DEMO_DATABASE), direct: withDatabase(direct, DEMO_DATABASE) };
}

/**
 * Never demo against a live store: refuses when this looks like production.
 * The demo is for a presenter's machine, not a deployment.
 */
export function assertNotProduction(): void {
  const site = process.env.SITE_URL ?? "";
  const live = /^https:\/\//.test(site) && !/localhost|127\.0\.0\.1/.test(site);
  if (process.env.NODE_ENV === "production" || live || process.env.RENDER) {
    throw new Error("This looks like a production environment. The demo toolkit only runs on a local machine.");
  }
}

/** A client for the demo database that has proved, via Postgres itself, where it is. */
export async function demoClient(url: string): Promise<PrismaClient> {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const [{ current_database: name }] = await db.$queryRaw<{ current_database: string }[]>`select current_database()`;
  assertDemoName(name);
  return db;
}

/** Network blips (a hotspot dropping DNS for a second) that are worth retrying. */
const TRANSIENT = /ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|Connection terminated/;

export async function withPg<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  let client: pg.Client | null = null;
  for (let attempt = 1; ; attempt++) {
    client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      break;
    } catch (error) {
      await client.end().catch(() => undefined);
      if (attempt >= 4 || !TRANSIENT.test(String((error as Error).message))) throw error;
      console.log(`  (network hiccup reaching the database, retrying in ${attempt * 2}s…)`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Row counts of the tables a demo could plausibly disturb, to prove it didn't. */
export const WATCHED_TABLES = [
  "Brand", "Category", "Product", "ProductBatch", "ProductImage", "StoreLocation", "Order", "OrderItem",
  "OrderEvent", "Review", "Coupon", "Bundle", "AdminUser", "AdminAuditLog", "AnalyticsEvent",
  "ConsentRecord", "Cart", "CartItem", "InvoiceSequence", "BusinessProfile", "StoreSettings",
] as const;

export async function tableCounts(url: string): Promise<Record<string, number>> {
  return withPg(url, async (c) => {
    const out: Record<string, number> = {};
    for (const t of WATCHED_TABLES) {
      const r = await c.query(`select count(*)::int as n from "${t}"`);
      out[t] = r.rows[0].n;
    }
    return out;
  });
}

/* ------------------------------------------------------------ determinism */

/** Seeded PRNG (mulberry32), so every demo build is the same dataset. */
export function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    /** Weighted pick: [[value, weight], ...]. */
    weighted: <T>(pairs: readonly (readonly [T, number])[]): T => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of pairs) {
        r -= w;
        if (r <= 0) return v;
      }
      return pairs[pairs.length - 1][0];
    },
    /** A random base-36 id fragment. */
    token: (length: number) => Array.from({ length }, () => Math.floor(next() * 36).toString(36)).join(""),
  };
}
export type Rng = ReturnType<typeof prng>;

export const DAY = 24 * 60 * 60 * 1000;
