/**
 * Prisma ORM 7 configuration.
 *
 * Prisma 7 removed `datasource.url` from schema.prisma entirely — the schema
 * file now describes shape only (models, enums, the provider name), and
 * anything environment-specific lives here instead. This file is what the
 * Prisma CLI reads for `migrate`, `generate`, `studio` and `db seed`; the
 * running application never imports it (see src/lib/db.ts for that side).
 *
 * `dotenv/config` is imported explicitly because this file runs as a
 * standalone CLI script, outside Next.js's own env loading — without it,
 * DATABASE_URL would be undefined here even though it works fine inside the
 * app itself.
 */
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
