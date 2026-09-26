/**
 * npm run demo:start [-- --dev]
 *
 * Serves the storefront and admin against the demo database at
 * http://localhost:3000. By default it makes a production build first: pages
 * are much faster than in dev, which matters in front of an audience. --dev
 * skips the build (hot reload, slower first loads).
 *
 * Nothing can leave the machine: email, payment, image-upload and error
 * reporting keys are blanked for this process only, so a demo "Mark shipped"
 * emails nobody and no card is ever charged. Next.js keeps variables that are
 * already set (even when empty) over .env.local, so these overrides win.
 */
import { config } from "dotenv";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { DEMO_DATABASE, assertNotProduction, demoUrls, mainUrls, withPg } from "./lib";

config({ path: ".env.local" });
config();

const dev = process.argv.includes("--dev");

async function main() {
  assertNotProduction();
  const main = mainUrls();
  const demo = demoUrls();
  const exists = await withPg(main.direct, async (c) => (await c.query("select 1 from pg_database where datname = $1", [DEMO_DATABASE])).rowCount);
  if (!exists) throw new Error(`${DEMO_DATABASE} doesn't exist yet. Run "npm run demo:up" first.`);

  const env = {
    ...process.env,
    DATABASE_URL: demo.pooled,
    DIRECT_URL: demo.direct,
    SITE_URL: "http://localhost:3000",
    // Nothing leaves the machine during the demo.
    RESEND_API_KEY: "",
    RAZORPAY_KEY_ID: "",
    RAZORPAY_KEY_SECRET: "",
    RAZORPAY_WEBHOOK_SECRET: "",
    CLOUDINARY_URL: "",
    SENTRY_DSN: "",
    // Matches the demo business profile, so the footer shows a licence.
    NEXT_PUBLIC_FSSAI_LICENCE_NUMBER: "10726001000417",
    NEXT_TELEMETRY_DISABLED: "1",
  };

  // Next keeps a data cache on disk (catalogue, business profile). Starting
  // clean means no real data shows in the demo; demo:down clears it again so
  // no demo data outlives the demo.
  if (existsSync(".next")) rmSync(".next", { recursive: true, force: true });

  // Fixed command strings only, through the shell so npx resolves on Windows too.
  if (!dev) {
    console.log("▸ Building for the demo (about a minute)…");
    const build = spawnSync("npx next build", { env: { ...env, NODE_ENV: "production" }, stdio: "inherit", shell: true });
    if (build.status !== 0) throw new Error("The build failed; see above.");
  }
  console.log(`▸ Serving the demo at http://localhost:3000 (storefront) and http://localhost:3000/admin (console). Ctrl+C to stop.`);
  const server = spawn(dev ? "npx next dev -p 3000" : "npx next start -p 3000", { env, stdio: "inherit", shell: true });
  server.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(`✘ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
