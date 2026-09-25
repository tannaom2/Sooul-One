import { createHmac, randomBytes } from "node:crypto";

/**
 * Two-factor recovery codes: ten single-use codes shown once, each accepted in
 * place of the authenticator code, for when the phone is lost. Pure (apart
 * from the random source), so it's tested directly.
 *
 * Format "K7PQM-3XW9R": 10 characters of Crockford base32, about 50 bits of
 * randomness each. The alphabet leaves out I, L, O and U, so codes read and
 * type without mix-ups, and reading one back forgives O for 0 and I/L for 1.
 * Only an HMAC fingerprint is stored, keyed with a server secret, so a copy of
 * the database alone can't be turned back into working codes.
 */

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT, random: (n: number) => Uint8Array = randomBytes): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = random(10);
    const chars = Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
    codes.add(`${chars.slice(0, 5)}-${chars.slice(5)}`);
  }
  return [...codes];
}

/** As typed, to the canonical 10 characters: capitals, no spaces or dashes, O→0, I/L→1. */
export function normaliseRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Whether what was typed at the two-factor step is a recovery code rather than a 6-digit one. */
export function looksLikeRecoveryCode(input: string): boolean {
  const code = normaliseRecoveryCode(input);
  return code.length === 10 && [...code].every((c) => ALPHABET.includes(c));
}

export function recoveryCodeFingerprint(input: string, secret: string): string {
  return createHmac("sha256", secret).update(normaliseRecoveryCode(input)).digest("hex");
}
