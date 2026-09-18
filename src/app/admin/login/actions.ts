"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  audit,
  clearSession,
  issueSession,
  readSession,
  verifyPassword,
  verifyTotp,
} from "@/lib/auth";

/**
 * Admin sign-in, as two deliberate steps.
 *
 * Step one accepts a password and issues a session marked `mfaVerified: false`.
 * That session reaches nothing — `requireAdmin` rejects it everywhere except
 * the MFA screen — so a stolen password alone is not access.
 *
 * Step two accepts a TOTP code and re-issues the session with the flag set.
 */

/**
 * In-memory attempt counter.
 *
 * Adequate for a single Render instance, which is what Section 10's cost
 * profile describes. It resets on deploy and does not span instances, so if
 * this ever runs on more than one container it must move to the database or a
 * shared cache. Flagged rather than silently assumed.
 */
const attempts = new Map<string, { count: number; firstAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now - record.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return false;
  }
  record.count += 1;
  return record.count > MAX_ATTEMPTS;
}

export interface LoginState {
  stage: "PASSWORD" | "MFA";
  error?: string;
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (rateLimited(email || "anonymous")) {
    return { stage: "PASSWORD", error: "Too many attempts. Wait 15 minutes and try again." };
  }

  const user = await db.adminUser.findUnique({ where: { email } });

  // One message for both "no such user" and "wrong password", so the form
  // cannot be used to discover which email addresses are registered.
  const generic = { stage: "PASSWORD" as const, error: "That email and password don't match." };

  if (!user || !user.isActive) return generic;
  if (!(await verifyPassword(password, user.passwordHash))) return generic;

  if (!user.mfaSecret) {
    return {
      stage: "PASSWORD",
      error:
        "This account has no authenticator set up. Run `npm run admin:create` to finish enrolment.",
    };
  }

  await issueSession({
    adminUserId: user.id,
    email: user.email,
    role: user.role,
    mfaVerified: false,
  });

  return { stage: "MFA" };
}

export async function verifyMfa(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const code = String(formData.get("code") ?? "");
  const session = await readSession();

  if (!session) return { stage: "PASSWORD", error: "That session expired. Sign in again." };
  if (rateLimited(`mfa:${session.email}`)) {
    await clearSession();
    return { stage: "PASSWORD", error: "Too many codes tried. Sign in again." };
  }

  const user = await db.adminUser.findUnique({ where: { id: session.adminUserId } });
  if (!user?.mfaSecret) return { stage: "PASSWORD", error: "Sign in again." };

  if (!verifyTotp(code, user.mfaSecret)) {
    return { stage: "MFA", error: "That code isn't right. Check your authenticator and retry." };
  }

  await issueSession({ ...session, mfaVerified: true });
  await db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(user.id, "SIGN_IN", "AdminUser", user.id);

  redirect("/admin");
}

export async function signOut() {
  await clearSession();
  redirect("/admin/login");
}
