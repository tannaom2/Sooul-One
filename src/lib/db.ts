/**
 * Prisma client singleton.
 *
 * Next.js hot-reloads modules in development, and a fresh PrismaClient per
 * reload exhausts the connection pool within a few minutes. Caching it on
 * globalThis is the documented way out; production gets one instance anyway.
 *
 * Prisma ORM 7 requires an explicit driver adapter for every relational
 * database — PrismaClient no longer accepts a bare connection string. This
 * wasn't a preview feature to opt into; the plain, no-adapter constructor this
 * file used before Prisma 7 would throw the moment it actually touched a
 * database, not merely fail to build. `pg`'s own defaults also changed: no
 * connection timeout and a 10-second idle timeout, versus Prisma 6's 5-second
 * and 300-second defaults — set explicitly below so behaviour doesn't drift
 * out from under this app on a future Prisma upgrade.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { Pool } from "pg";
import { withConnectRetry } from "./db-retry";

// Node tries each of a host's addresses for only 250 ms before moving on
// ("happy eyeballs"). Neon's pooler has several addresses, and a round trip to
// us-east-2 takes about 200 ms from Singapore and 255–300 ms from some Indian
// networks, so every attempt was cut off just short of connecting and the
// connection failed with ETIMEDOUT after ~0.8 s. Two seconds per address
// connects every time (measured: 0/10 → 10/10); a truly unreachable address
// still fails over to the next.
setDefaultAutoSelectFamilyAttemptTimeout(2000);

function createClient(adapter: PrismaPg) {
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }).$extends({
    // A suspended Neon database can take longer to accept the first
    // connection than the timeout allows. Retry only those connect failures
    // — see src/lib/db-retry.ts for why nothing else is retried.
    query: { $allOperations: ({ args, query }) => withConnectRetry(() => query(args)) },
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient>; pgPool?: Pool };

const pool =
  globalForPrisma.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    // Opening a connection to Neon (us-east-2) costs seconds from India —
    // measured 7–24s on a bad day — so keep open ones around instead of
    // closing them after 30s idle and paying that again on the next page.
    idleTimeoutMillis: 10 * 60_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 30_000,
    connectionTimeoutMillis: 30_000,
  });

const adapter = new PrismaPg(pool);

export const db = globalForPrisma.prisma ?? createClient(adapter);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.pgPool = pool;
}
