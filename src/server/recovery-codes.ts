import "server-only";
import { db } from "@/lib/db";
import { generateRecoveryCodes, recoveryCodeFingerprint } from "@/lib/recovery-codes";

/** The server secret the fingerprints are keyed with. Rotating JWT_SECRET voids every code. */
function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("JWT_SECRET must be set to at least 32 characters.");
  return value;
}

/**
 * A fresh set of codes for an account, replacing any it had. Returns the
 * plain codes to show once; only fingerprints are stored.
 */
export async function issueRecoveryCodes(adminUserId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const key = secret();
  await db.$transaction([
    db.adminRecoveryCode.deleteMany({ where: { adminUserId } }),
    db.adminRecoveryCode.createMany({
      data: codes.map((code) => ({ adminUserId, codeHash: recoveryCodeFingerprint(code, key) })),
    }),
  ]);
  return codes;
}

/**
 * Spend one code. True only if it matched an unused code for this account;
 * the conditional update means a code can't be used twice, even at once.
 */
export async function spendRecoveryCode(adminUserId: string, input: string): Promise<boolean> {
  const { count } = await db.adminRecoveryCode.updateMany({
    where: { adminUserId, codeHash: recoveryCodeFingerprint(input, secret()), usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

/** Unused codes left, and whether the account has ever had a set. */
export async function recoveryCodeStatus(adminUserId: string): Promise<{ remaining: number; issued: boolean }> {
  const [remaining, total] = await Promise.all([
    db.adminRecoveryCode.count({ where: { adminUserId, usedAt: null } }),
    db.adminRecoveryCode.count({ where: { adminUserId } }),
  ]);
  return { remaining, issued: total > 0 };
}
