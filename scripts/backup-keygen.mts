/**
 * Make the backup key pair, once. The PUBLIC key goes into the repo
 * (.github/backup-recipient.txt) so the nightly job can encrypt; the PRIVATE
 * key is written to a file outside the repo, for the owner to move into their
 * password manager and then delete. It is never printed.
 *
 *   npx tsx scripts/backup-keygen.mts [path-for-private-key]
 */
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as age from "age-encryption";

const keyPath = resolve(process.argv[2] ?? join(homedir(), "sooulone-backup-private-key.txt"));
const recipientPath = resolve(".github/backup-recipient.txt");
if (existsSync(keyPath)) {
  console.error(`${keyPath} already exists. Refusing to overwrite a key that may be the only way into existing backups.`);
  process.exit(1);
}
if (keyPath.startsWith(resolve("."))) {
  console.error("Write the private key outside the repository, so it can never be committed.");
  process.exit(1);
}

const identity = await age.generateIdentity();
const recipient = await age.identityToRecipient(identity);
const created = new Date().toISOString();

writeFileSync(
  keyPath,
  `# SooulOne database backup PRIVATE key, created ${created}\n` +
    `# Opens every nightly backup. Store it in your password manager, then delete this file.\n` +
    `# Anyone with this line can read a backup; without it, nobody can, including you.\n` +
    `# public key: ${recipient}\n${identity}\n`,
  { mode: 0o600 },
);
writeFileSync(recipientPath, `# SooulOne backup public key (age). Backups are encrypted to it; see docs/DR.md.\n# created ${created}\n${recipient}\n`);

console.log(`Private key written to ${keyPath}`);
console.log(`Public key written to .github/backup-recipient.txt: ${recipient}`);
