/**
 * npm run demo:intel — add the intelligence reports' demo data (pincodes,
 * payment attempts, pincode checks, risk scores) to an existing demo database
 * (a fresh `demo:up` includes it already). Runs once; a second run changes nothing.
 *
 * Never touches the real database: the URL is rewritten to the demo one and
 * Postgres is asked which database it is before anything runs.
 */
import { config } from "dotenv";
import { assertNotProduction, demoClient, demoUrls } from "./lib";
import { seedIntel } from "./intel";

config({ path: ".env.local" });
assertNotProduction();

const db = await demoClient(demoUrls().pooled);
try {
  const result = await seedIntel(db);
  console.log(
    result.skipped
      ? "✔ Intelligence demo data is already there; nothing changed."
      : `✔ Orders regrouped by pincode: ${result.moved} · payment attempts added: ${result.attempts} · pincode checks: ${result.checks} · orders scored: ${result.scored}`,
  );
} finally {
  await db.$disconnect();
}
