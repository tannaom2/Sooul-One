"use server";

import { redirect } from "next/navigation";
import { generateURI } from "otplib";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import {
  audit,
  clearSession,
  hashPassword,
  issueSession,
  newMfaSecret,
  readSession,
  verifyPassword,
  verifyTotp,
} from "@/lib/auth";
import { MIN_PASSWORD_LENGTH, isValidSetupKey } from "@/lib/team-rules";
import { looksLikeRecoveryCode } from "@/lib/recovery-codes";
import { recoveryCodeStatus, spendRecoveryCode } from "@/server/recovery-codes";

/**
 * Admin sign-in, as deliberate steps.
 *
 * PASSWORD accepts email and password and issues a session marked
 * `mfaVerified: false`. That session reaches nothing — `requireAdmin` rejects
 * it everywhere — so a stolen password alone is not access.
 *
 * MFA accepts a TOTP code and re-issues the session with the flag set.
 *
 * ENROL is the first sign-in of someone added on the Team page (or whose
 * access was reset): the password they have is a one-time temporary one, so
 * they choose their own and set up an authenticator before getting in.
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
  stage: "PASSWORD" | "MFA" | "ENROL";
  error?: string;
  /** ENROL only: the authenticator key to add, and the same as a QR code. */
  setupKey?: string;
  setupQrSvg?: string;
}

async function enrolState(email: string, setupKey: string, error?: string): Promise<LoginState> {
  const uri = generateURI({ issuer: "SooulOne", label: email, secret: setupKey });
  const setupQrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { stage: "ENROL", setupKey, setupQrSvg, error };
}

/** One entry point, so the page holds a single state that can't disagree with itself. */
export async function authenticate(_prev: LoginState, form: FormData): Promise<LoginState> {
  switch (String(form.get("step") ?? "")) {
    case "mfa":
      return verifyMfa(form);
    case "enrol":
      return completeEnrolment(form);
    default:
      return signIn(form);
  }
}

async function signIn(form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  const user = await db.adminUser.findUnique({ where: { email } });
  // The email is attacker-supplied on a failed attempt, so it's truncated.
  const actor = { adminUserId: user?.id ?? null, email: email.slice(0, 200) || "(blank)" };

  if (rateLimited(email || "anonymous")) {
    await audit(actor, "SIGN_IN_LOCKED", "AdminUser", user?.id ?? "-");
    return { stage: "PASSWORD", error: "Too many attempts. Wait 15 minutes and try again." };
  }

  // One message for both "no such user" and "wrong password", so the form
  // cannot be used to discover which email addresses are registered. The
  // audit log (owner-only) does record which it was.
  const generic = { stage: "PASSWORD" as const, error: "That email and password don't match." };

  if (!user || !user.isActive) {
    await audit(actor, "SIGN_IN_FAILED", "AdminUser", user?.id ?? "-", { reason: user ? "inactive" : "unknown_email" });
    return generic;
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    await audit(actor, "SIGN_IN_FAILED", "AdminUser", user.id, { reason: "wrong_password" });
    return generic;
  }

  await issueSession({
    adminUserId: user.id,
    email: user.email,
    role: user.role,
    mfaVerified: false,
    sessionVersion: user.sessionVersion,
  });

  return user.mfaSecret ? { stage: "MFA" } : enrolState(user.email, newMfaSecret());
}

async function verifyMfa(form: FormData): Promise<LoginState> {
  const code = String(form.get("code") ?? "");
  const session = await readSession();

  if (!session) return { stage: "PASSWORD", error: "That session expired. Sign in again." };
  if (rateLimited(`mfa:${session.email}`)) {
    await audit(session, "MFA_LOCKED", "AdminUser", session.adminUserId);
    await clearSession();
    return { stage: "PASSWORD", error: "Too many codes tried. Sign in again." };
  }

  const user = await db.adminUser.findUnique({ where: { id: session.adminUserId } });
  if (!user?.mfaSecret || !user.isActive || user.sessionVersion !== (session.sessionVersion ?? 0)) {
    await clearSession();
    return { stage: "PASSWORD", error: "Sign in again." };
  }

  // A recovery code (lost phone) is accepted in place of the authenticator's.
  // Each works once, and using one is always logged, with how many are left.
  if (looksLikeRecoveryCode(code)) {
    if (!(await spendRecoveryCode(user.id, code))) {
      await audit(session, "MFA_FAILED", "AdminUser", user.id, { with: "recovery_code" });
      return { stage: "MFA", error: "That recovery code isn't right, or it has already been used." };
    }
    const { remaining } = await recoveryCodeStatus(user.id);
    await issueSession({ ...session, mfaVerified: true });
    await db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit(session, "SIGN_IN_WITH_RECOVERY_CODE", "AdminUser", user.id, { remaining });
    redirect("/admin/account?recovered=1");
  }

  // Worth logging on its own: a wrong code after a right password means
  // someone has the password.
  if (!verifyTotp(code, user.mfaSecret)) {
    await audit(session, "MFA_FAILED", "AdminUser", user.id);
    return { stage: "MFA", error: "That code isn't right. Check your authenticator and retry." };
  }

  await issueSession({ ...session, mfaVerified: true });
  await db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(session, "SIGN_IN", "AdminUser", user.id);

  redirect("/admin");
}

async function completeEnrolment(form: FormData): Promise<LoginState> {
  const session = await readSession();
  if (!session) return { stage: "PASSWORD", error: "That session expired. Sign in again." };

  // The key comes back from the browser. It only ever becomes the secret for
  // the account whose temporary password was just entered, so a tampered key
  // gains nothing — but it must still be a well-formed one.
  const setupKey = String(form.get("setupKey") ?? "");
  if (!isValidSetupKey(setupKey)) {
    await clearSession();
    return { stage: "PASSWORD", error: "Sign in again." };
  }
  const retry = (error: string) => enrolState(session.email, setupKey, error);

  if (rateLimited(`enrol:${session.email}`)) {
    await audit(session, "MFA_LOCKED", "AdminUser", session.adminUserId, { during: "enrolment" });
    await clearSession();
    return { stage: "PASSWORD", error: "Too many tries. Sign in again in 15 minutes." };
  }

  const user = await db.adminUser.findUnique({ where: { id: session.adminUserId } });
  // Already enrolled means this isn't a first sign-in: an existing
  // authenticator is never replaced from here, only via reset on the Team page.
  if (!user || !user.isActive || user.mfaSecret || user.sessionVersion !== (session.sessionVersion ?? 0)) {
    await clearSession();
    return { stage: "PASSWORD", error: "Sign in again." };
  }

  const password = String(form.get("newPassword") ?? "");
  const confirm = String(form.get("confirmPassword") ?? "");
  const code = String(form.get("code") ?? "");

  if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    return retry(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password !== confirm) return retry("The two passwords don't match.");
  if (await verifyPassword(password, user.passwordHash)) {
    return retry("Choose a new password, not the temporary one you were given.");
  }
  if (!verifyTotp(code, setupKey)) {
    await audit(session, "MFA_FAILED", "AdminUser", user.id, { during: "enrolment" });
    return retry("That code isn't right. Check the app shows SooulOne and try the current code.");
  }

  // Bumping the version ends any other session still holding the temporary password.
  const updated = await db.adminUser.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      mfaSecret: setupKey,
      lastLoginAt: new Date(),
      sessionVersion: { increment: 1 },
    },
  });
  await issueSession({ ...session, mfaVerified: true, sessionVersion: updated.sessionVersion });
  await audit(session, "MFA_ENROLLED", "AdminUser", user.id);

  // Straight on to making recovery codes. Shown on their own page rather than
  // here: signing in swaps this page's layout for the console's, which would
  // discard anything this form was about to display.
  redirect("/admin/account?welcome=1");
}

export async function signOut() {
  const session = await readSession();
  if (session) await audit(session, "SIGN_OUT", "AdminUser", session.adminUserId);
  await clearSession();
  redirect("/admin/login");
}
