/**
 * Nightly backup, step 3 (run in GitHub Actions): encrypt the verified dump to
 * the public key in .github/backup-recipient.txt, write a manifest with the
 * plain dump's SHA-256, and delete the plain dump.
 *
 *   npx tsx scripts/backup-encrypt.mts <dump-file> <output-dir>
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { encryptBytes, readRecipient, sha256 } from "./backup-lib.mts";

const [dumpPath, outDir] = process.argv.slice(2);
if (!dumpPath || !outDir) {
  console.error("Usage: backup-encrypt.mts <dump-file> <output-dir>");
  process.exit(1);
}

const recipient = readRecipient(readFileSync(".github/backup-recipient.txt", "utf8"));
const plain = new Uint8Array(readFileSync(dumpPath));
const cipher = await encryptBytes(plain, recipient);

mkdirSync(outDir, { recursive: true });
const name = basename(dumpPath);
writeFileSync(join(outDir, `${name}.age`), cipher);
writeFileSync(
  join(outDir, `${name}.manifest.json`),
  JSON.stringify(
    {
      file: `${name}.age`,
      createdAt: new Date().toISOString(),
      format: "pg_dump custom format (-Fc), encrypted with age",
      plainBytes: plain.byteLength,
      plainSha256: sha256(plain),
      recipient,
    },
    null,
    2,
  ),
);
rmSync(dumpPath);
console.log(`Encrypted ${plain.byteLength} bytes to ${join(outDir, `${name}.age`)}; plain dump deleted.`);
