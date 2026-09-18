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
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; pgPool?: Pool };

const pool =
  globalForPrisma.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

const adapter = new PrismaPg(pool);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.pgPool = pool;
}
