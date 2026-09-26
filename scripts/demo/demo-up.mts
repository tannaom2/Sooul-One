/**
 * npm run demo:up [-- --fresh] [-- --presenter you+demo@example.com]
 *
 * Creates the `sooulone_demo` database next to the real one, applies every
 * migration, seeds brands and categories, generates the demo dataset, writes
 * pack illustrations, and creates a presenter (owner) account that sets its
 * own password and authenticator at first sign-in. The real database is only
 * ever read (row counts, to prove afterwards it wasn't touched).
 *
 * See docs/DEMO.md.
 */
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { CATALOGUE } from "./catalogue";
import { packArt } from "./pack-art";
import { generateDemo } from "./generate";
import { DEMO_DATABASE, assertDemoName, assertNotProduction, databaseOf, demoClient, demoUrls, mainUrls, tableCounts, withPg } from "./lib";
import { verifyDemo } from "./verify";

config({ path: ".env.local" });
config();

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const presenterArg = args[args.indexOf("--presenter") + 1];
const presenter = (args.includes("--presenter") && presenterArg ? presenterArg : "tannaom2+demo@gmail.com").toLowerCase();

const step = (text: string) => console.log(`\n▸ ${text}`);

async function main() {
  assertNotProduction();
  assertDemoName(DEMO_DATABASE);
  const main = mainUrls();
  const demo = demoUrls();
  console.log(`Real database: ${databaseOf(main.direct)} (read only)\nDemo database: ${DEMO_DATABASE} (created by this script)`);

  step("Recording the real database's row counts, to prove later that the demo never touched it");
  mkdirSync(".demo", { recursive: true });
  writeFileSync(".demo/baseline.json", JSON.stringify({ at: new Date().toISOString(), counts: await tableCounts(main.direct) }, null, 2));

  const exists = await withPg(main.direct, async (c) => (await c.query("select 1 from pg_database where datname = $1", [DEMO_DATABASE])).rowCount);
  if (exists && !fresh) throw new Error(`${DEMO_DATABASE} already exists. Run "npm run demo:down" first, or "npm run demo:up -- --fresh" to rebuild it.`);

  const childEnv = { ...process.env, DATABASE_URL: demo.pooled, DIRECT_URL: demo.direct };
  // Fixed command strings only (no user input), through the shell so npx resolves on Windows too.
  const run = (command: string) => {
    const result = spawnSync(command, { env: childEnv, stdio: ["ignore", "pipe", "pipe"], shell: true, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
  };

  // The whole build is the unit of retry: on a flaky connection (a hotspot),
  // a dropped connection part-way through rebuilds from an empty database
  // rather than leaving a half-seeded one.
  const build = async () => {
    step(`Creating database ${DEMO_DATABASE}`);
    await withPg(main.direct, async (c) => {
      await c.query(`drop database if exists "${DEMO_DATABASE}" with (force)`);
      await c.query(`create database "${DEMO_DATABASE}"`);
    });

    step("Applying every migration to the demo database");
    run("npx prisma migrate deploy");

    step("Seeding brands and categories (prisma/seed.ts)");
    run("npx tsx prisma/seed.ts");

    step("Generating the demo dataset: 90 days of store history");
    const db = await demoClient(demo.direct);
    try {
      const summary = await generateDemo(db);

      step("Creating the presenter account");
      // No look-alike characters (0/O, 1/l/I), so it's easy to read off a screen.
      const alphabet = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
      const tempPassword = Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join("");
      await db.adminUser.create({
        data: { email: presenter, name: "Om Tanna", role: "OWNER", passwordHash: await bcrypt.hash(tempPassword, 12), mfaSecret: null },
      });

      step("Checking the dataset is internally consistent");
      const problems = await verifyDemo(db);
      if (problems.length) throw new Error(`The demo dataset failed its checks:\n  - ${problems.join("\n  - ")}`);
      return { summary, tempPassword };
    } finally {
      await db.$disconnect().catch(() => undefined);
    }
  };

  const NETWORK = /ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|Connection terminated|Can't reach database server|DatabaseNotReachable|P1001|P1017/;
  let result: Awaited<ReturnType<typeof build>> | undefined;
  for (let attempt = 1; !result; attempt++) {
    try {
      result = await build();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 3 || !NETWORK.test(message)) throw error;
      console.log(`\n  The connection dropped (${message.split("\n")[0].slice(0, 80)}). Rebuilding from scratch, attempt ${attempt + 1} of 3…`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  const { summary, tempPassword } = result;

  step("Writing pack illustrations to public/demo-assets/");
  if (existsSync("public/demo-assets")) rmSync("public/demo-assets", { recursive: true });
  mkdirSync("public/demo-assets", { recursive: true });
  for (const p of CATALOGUE) writeFileSync(`public/demo-assets/${p.slug}.svg`, packArt(p));

  step("Confirming the real database is exactly as it was");
  const before = JSON.parse((await import("node:fs")).readFileSync(".demo/baseline.json", "utf8")).counts as Record<string, number>;
  const after = await tableCounts(main.direct);
  const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
  console.log(changed.length ? `  Changed while this ran (other activity?): ${changed.join(", ")}` : "  Untouched: every table has the same row count.");

  writeFileSync(".demo/state.json", JSON.stringify({ createdAt: new Date().toISOString(), database: DEMO_DATABASE, presenter }, null, 2));

  const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  console.log(`
✔ Demo environment ready.

  ${summary.products} products · ${summary.batches} stock batches · ${summary.orders} orders (${summary.orderItems} items)
  ${summary.invoices} GST invoices · ${summary.reviews} published reviews + ${summary.pendingReviews} awaiting moderation
  ${summary.sessions.toLocaleString("en-IN")} shopper sessions (${summary.analyticsEvents.toLocaleString("en-IN")} events) · ${summary.auditRows} activity-log entries
  ${summary.staff} team members · ${rupees.format(summary.revenuePaise / 100)} in kept revenue over 90 days

  Presenter sign-in (owner): ${presenter}
  Temporary password:        ${tempPassword}
  (Shown once. At first sign-in you choose your own password and scan a QR
  code into your authenticator: that entry is labelled with the demo email.)

  Next: npm run demo:start    ·    Afterwards: npm run demo:down
`);
}

main().catch((error) => {
  console.error(`\n✘ ${error instanceof Error ? error.message : error}`);
  console.error("  Nothing was written to the real database. To clear a half-built demo: npm run demo:down");
  process.exit(1);
});
