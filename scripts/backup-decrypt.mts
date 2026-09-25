/**
 * Open a backup (docs/DR.md, "Restore"): decrypt a downloaded .age file with
 * the owner's private key and check it against its manifest's SHA-256.
 * Writes the plain dump next to it, ready for pg_restore.
 *
 *   npx tsx scripts/backup-decrypt.mts <backup.dump.age> <private-key-file>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { decryptBytes, readIdentity, sha256 } from "./backup-lib.mts";

const [agePath, keyPath] = process.argv.slice(2);
if (!agePath || !keyPath) {
  console.error("Usage: backup-decrypt.mts <backup.dump.age> <private-key-file>");
  process.exit(1);
}

const plain = await decryptBytes(new Uint8Array(readFileSync(agePath)), readIdentity(readFileSync(keyPath, "utf8")));
const out = agePath.replace(/\.age$/, "");
const manifestPath = `${out}.manifest.json`;
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.plainSha256 !== sha256(plain)) {
    console.error("Checksum mismatch: this backup is damaged or doesn't match its manifest. Try the previous night's.");
    process.exit(1);
  }
  console.log(`Checksum matches the manifest (${manifest.createdAt}).`);
}
writeFileSync(out, plain);
console.log(`Decrypted ${plain.byteLength} bytes to ${out}. Restore it with pg_restore (docs/DR.md).`);
