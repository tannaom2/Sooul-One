"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission, verifyTotp } from "@/lib/auth";
import { issueRecoveryCodes } from "@/server/recovery-codes";
import { MFA_LIMIT } from "@/lib/rate-limit-rules";
import { clearHits, overLimit } from "@/server/rate-limit";

export interface RecoveryResult {
  ok: boolean;
  message?: string;
  codes?: string[];
}

/**
 * A fresh set of recovery codes for the signed-in admin, replacing the old
 * ones. Asks for the current authenticator code, so a session left open on
 * someone else's screen can't be used to mint a way back in.
 */
export async function regenerateRecoveryCodes(_prev: RecoveryResult, form: FormData): Promise<RecoveryResult> {
  const session = await requirePermission("dashboard:view");
  if (!session) return { ok: false, message: "Sign in again." };

  const user = await db.adminUser.findUnique({ where: { id: session.adminUserId }, select: { id: true, mfaSecret: true } });
  if (!user?.mfaSecret) return { ok: false, message: "Set up your authenticator first." };

  // Shares the sign-in 2FA counter, so an open session can't be used to guess codes.
  if (await overLimit(`mfa:${user.id}`, MFA_LIMIT)) {
    await audit(session, "MFA_LOCKED", "AdminUser", user.id, { during: "recovery_code_regeneration" });
    return { ok: false, message: "Too many codes tried. Wait 15 minutes and try again." };
  }
  if (!verifyTotp(String(form.get("code") ?? ""), user.mfaSecret)) {
    await audit(session, "MFA_FAILED", "AdminUser", user.id, { during: "recovery_code_regeneration" });
    return { ok: false, message: "That authenticator code isn't right. Try the current one." };
  }

  await clearHits([`mfa:${user.id}`]);
  const codes = await issueRecoveryCodes(user.id);
  await audit(session, "RECOVERY_CODES_ISSUED", "AdminUser", user.id, { count: codes.length, replacedOldSet: true });
  revalidatePath("/admin/account");
  revalidatePath("/admin");
  return { ok: true, codes };
}
