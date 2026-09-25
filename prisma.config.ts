/**
 * Prisma ORM 7 configuration.
 *
 * Prisma 7 removed `datasource.url` from schema.prisma entirely — the schema
 * file now describes shape only (models, enums, the provider name), and
 * anything environment-specific lives here instead. This file is what the
 * Prisma CLI reads for `migrate`, `generate`, `studio` and `db seed`; the
 * running application never imports it (see src/lib/db.ts for that side).
 *
 * dotenv is loaded explicitly because this file runs as a standalone CLI
 * script, outside Next.js's own env loading — without it, DATABASE_URL would
 * be undefined here even though it works fine inside the app itself. Next.js
 * reads `.env.local` first among the dev-only files; `dotenv`'s default
 * export only reads `.env`, so it has to be told about `.env.local`
 * explicitly or every local run fails to find DATABASE_URL.
 */
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ path: ".env.local" });
config(); // .env, for values .env.local doesn't set (e.g. CI/production)

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations use the DIRECT connection when one is set: Prisma's migration
    // lock (a Postgres advisory lock) isn't reliable through Neon's pooler
    // (PgBouncer), which is why migrate deploy kept timing out on "acquire a
    // postgres advisory lock". The app itself keeps the pooled DATABASE_URL.
    url: process.env.DIRECT_URL || env("DATABASE_URL"),
  },
});
