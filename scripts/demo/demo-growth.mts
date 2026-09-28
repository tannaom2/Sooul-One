/**
 * npm run demo:growth — add the Make Your Own Box and referral demo data to
 * an existing demo database (a fresh `demo:up` includes it already).
 *
 * Never touches the real database: the URL is rewritten to the demo one and
 * Postgres is asked which database it is before anything runs.
 */
import { config } from "dotenv";
import { assertNotProduction, demoClient, demoUrls } from "./lib";
import { seedGrowth } from "./growth";

config({ path: ".env.local" });
assertNotProduction();

const db = await demoClient(demoUrls().pooled);
try {
  const result = await seedGrowth(db);
  console.log(`✔ Boxes added: ${result.boxes} · landed costs set: ${result.costsSet} · sample referrals: ${result.referrals}`);
} finally {
  await db.$disconnect();
}
