/**
 * Create the first owner account, with MFA enrolment.
 *
 * Interactive rather than seeded: a seeded admin password ends up in version
 * control or in a shared document, and this account can change every price on
 * the site. Run with `npm run admin:create`.
 */
import { config } from "dotenv";
import { createInterface } from "node:readline/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { generateSecret, generateURI } from "otplib";

// Runs outside Next.js, so env files aren't loaded for it: .env.local first,
// as in prisma.config.ts, then .env for anything it doesn't set.
config({ path: ".env.local" });
config();

// Prisma 7 requires an explicit driver adapter — see src/lib/db.ts.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const email = (await rl.question("Email: ")).trim().toLowerCase();
  const name = (await rl.question("Name: ")).trim();
  const password = (await rl.question("Password (min 12 characters): ")).trim();

  if (password.length < 12) {
    console.error("\nToo short. This account can edit every price on the site.");
    process.exit(1);
  }

  const secret = generateSecret();
  const uri = generateURI({ issuer: "SooulOne", label: email, secret });

  const user = await db.adminUser.upsert({
    where: { email },
    update: { name, passwordHash: await bcrypt.hash(password, 12), mfaSecret: secret, role: "OWNER", isActive: true },
    create: { email, name, passwordHash: await bcrypt.hash(password, 12), mfaSecret: secret, role: "OWNER" },
  });

  console.log(`\nAccount ready for ${user.email}.`);
  console.log("\nAdd this to your authenticator app (Google Authenticator, Authy, 1Password):");
  console.log(`\n  Setup key: ${secret}`);
  console.log(`  Or this URI: ${uri}\n`);
  console.log("You will need a code from that app every time you sign in.\n");

  await rl.close();
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
