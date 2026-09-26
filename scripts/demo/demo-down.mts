/**
 * npm run demo:down
 *
 * Removes the demo completely: drops the `sooulone_demo` database (every
 * demo row goes with it, so nothing can be left orphaned), deletes the pack
 * illustrations and Next's on-disk data cache, then proves two things: the
 * demo database no longer exists, and the real database has the same row
 * counts it had before the demo was set up.
 *
 * Safe to run twice, and safe after a half-finished demo:up.
 */
import { config } from "dotenv";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { DEMO_DATABASE, assertDemoName, assertNotProduction, databaseOf, mainUrls, tableCounts, withPg } from "./lib";

config({ path: ".env.local" });
config();

async function main() {
  assertNotProduction();
  assertDemoName(DEMO_DATABASE);
  const main = mainUrls();
  if (databaseOf(main.direct) === DEMO_DATABASE) throw new Error("The real connection string points at the demo database; refusing.");

  console.log(`▸ Dropping ${DEMO_DATABASE} (connections to it are closed first)`);
  await withPg(main.direct, async (c) => {
    await c.query(`drop database if exists "${DEMO_DATABASE}" with (force)`);
    const left = (await c.query("select 1 from pg_database where datname = $1", [DEMO_DATABASE])).rowCount;
    if (left) throw new Error(`${DEMO_DATABASE} still exists after the drop.`);
  });
  console.log("  Gone: the database and every row in it.");

  console.log("▸ Removing pack illustrations and Next's data cache");
  for (const path of ["public/demo-assets", ".next"]) if (existsSync(path)) rmSync(path, { recursive: true, force: true });

  console.log("▸ Checking the real database against the count taken before the demo");
  const after = await tableCounts(main.direct);
  if (existsSync(".demo/baseline.json")) {
    const { at, counts: before } = JSON.parse(readFileSync(".demo/baseline.json", "utf8")) as { at: string; counts: Record<string, number> };
    const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
    if (changed.length) {
      console.log(`  These tables changed since ${at}. The demo never writes to this database, so this is other activity`);
      console.log("  (for example the real app running meanwhile). Review if unexpected:");
      for (const t of changed) console.log(`    ${t}: ${before[t]} → ${after[t]}`);
    } else {
      console.log(`  Untouched: every table matches the count from ${at}.`);
    }
  } else {
    console.log("  No baseline found (demo:up didn't get that far); skipped.");
  }
  rmSync(".demo", { recursive: true, force: true });

  console.log(`\n✔ Demo removed. Start your normal app again with: npm run dev`);
}

main().catch((error) => {
  console.error(`✘ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
