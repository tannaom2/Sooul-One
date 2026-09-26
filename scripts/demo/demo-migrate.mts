/**
 * npm run demo:migrate — apply new migrations to the demo database only,
 * keeping its data. For a code change that adds a column between demo:up and
 * the demo itself; demo:up applies every migration on a fresh build anyway.
 *
 * Never touches the real database: the URL is rewritten to the demo one and
 * Postgres is asked which database it is before anything runs.
 */
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { assertNotProduction, demoClient, demoUrls } from "./lib";

config({ path: ".env.local" });
assertNotProduction();

const demo = demoUrls();
// Proves, via Postgres itself, that this is a *_demo database (throws otherwise).
const db = await demoClient(demo.pooled);
await db.$disconnect();

const result = spawnSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: demo.pooled, DIRECT_URL: demo.direct },
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
