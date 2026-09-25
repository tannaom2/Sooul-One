/**
 * Shared pieces of the backup pipeline (docs/DR.md). Encryption uses age
 * (X25519): backups are encrypted to a public key committed in the repo and
 * can only be opened with the owner's private key, which never leaves their
 * password manager. Pure apart from crypto, so it's tested directly.
 */
import { createHash } from "node:crypto";
import * as age from "age-encryption";

export async function encryptBytes(plain: Uint8Array, recipient: string): Promise<Uint8Array> {
  const e = new age.Encrypter();
  e.addRecipient(recipient.trim());
  return e.encrypt(plain);
}

export async function decryptBytes(cipher: Uint8Array, identity: string): Promise<Uint8Array> {
  const d = new age.Decrypter();
  d.addIdentity(identity.trim());
  return d.decrypt(cipher);
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The first line that looks like an age secret key, ignoring comments. */
export function readIdentity(fileText: string): string {
  const key = fileText.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("AGE-SECRET-KEY-"));
  if (!key) throw new Error("No AGE-SECRET-KEY line found in the key file.");
  return key;
}

/** The recipient (public key) line, ignoring comments. */
export function readRecipient(fileText: string): string {
  const key = fileText.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("age1"));
  if (!key) throw new Error("No age1… recipient line found.");
  return key;
}

export interface CountMismatch {
  readonly table: string;
  readonly source: number;
  readonly restored: number | null;
}

/** Tables whose row counts differ between the live database and the restored copy. */
export function compareCounts(source: Record<string, number>, restored: Record<string, number>): CountMismatch[] {
  return Object.keys(source)
    .sort()
    .filter((t) => restored[t] !== source[t])
    .map((t) => ({ table: t, source: source[t], restored: restored[t] ?? null }));
}
