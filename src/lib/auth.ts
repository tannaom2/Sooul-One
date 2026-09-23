/**
 * Admin console authentication — build prompt Sections 7.5 and 8.1.
 *
 * Deliberately separate from customer auth. The owner console can edit prices,
 * publish products and read every order, so it is the highest-value target in
 * the system and deserves its own small, auditable surface rather than sharing
 * a session mechanism with the storefront. A bug in customer login must not be
 * a path into the dashboard.
 *
 * Three layers, none of which is sufficient alone:
 *   1. A non-obvious console path (ADMIN_PATH) — removes it from opportunistic
 *      scanning. Not security; it buys quiet, not safety.
 *   2. bcrypt password + TOTP second factor, mandatory for OWNER.
 *   3. Short-lived JWT in an httpOnly, SameSite=Strict cookie, so no script on
 *      the page can read it and no cross-site form can replay it.
 */

import "server-only";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { generateSecret, verifySync } from "otplib";
import { cookies, headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { can, type AdminRole, type Permission } from "./permissions";

const COOKIE = "soulone_admin";
const TTL_SECONDS = 60 * 60 * 8; // one working day
const BCRYPT_ROUNDS = 12;

export interface AdminSession {
  readonly adminUserId: string;
  readonly email: string;
  readonly role: AdminRole;
  /** False until the TOTP code has been accepted this session. */
  readonly mfaVerified: boolean;
}

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    // Failing loudly at boot beats signing tokens with a weak or absent key and
    // discovering it in production.
    throw new Error("JWT_SECRET must be set to at least 32 characters.");
  }
  return value;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function newMfaSecret(): string {
  return generateSecret();
}

/**
 * No `mfaUri` export here.
 *
 * Enrolment happens once, in `scripts/create-admin.ts`, which calls
 * `generateURI` from otplib directly. A wrapper with the same job living in
 * two places is how they drift — if the issuer name ever changes it should
 * change in exactly one file, and that file is the one that runs once per
 * account rather than the one that runs on every request.
 */
/**
 * Verify a TOTP code.
 *
 * A 30-second past tolerance is allowed because a code typed at the very end
 * of its window routinely arrives after it has rolled over, and rejecting that
 * teaches people the second factor is broken. Tolerance is past-only — there
 * is no legitimate reason to accept a code from the future.
 */
export function verifyTotp(token: string, secretKey: string): boolean {
  try {
    const result = verifySync({
      token: token.replace(/\s/g, ""),
      secret: secretKey,
      epochTolerance: [30, 0],
    });
    return result.valid === true;
  } catch {
    return false;
  }
}

export async function issueSession(session: AdminSession): Promise<void> {
  // Callers sometimes spread a session read back from readSession() (e.g.
  // verifyMfa re-issuing with mfaVerified: true) — that payload carries a
  // decoded `exp` claim from jwt.verify, which jwt.sign rejects alongside its
  // own `expiresIn`. Sign only the fields the session actually is.
  const { adminUserId, email, role, mfaVerified } = session;
  const payload: AdminSession = { adminUserId, email, role, mfaVerified };
  const token = jwt.sign(payload, secret(), { expiresIn: TTL_SECONDS });
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function readSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, secret()) as AdminSession;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/**
 * Session for a fully authenticated admin, or null.
 *
 * Password-only sessions are treated as unauthenticated everywhere except the
 * MFA step itself, so a stolen password alone reaches nothing.
 */
export async function requireAdmin(): Promise<AdminSession | null> {
  const session = await readSession();
  if (!session || !session.mfaVerified) return null;
  return session;
}

/**
 * Session for an authenticated admin whose role grants `permission`, or null.
 *
 * Every admin page and every mutation calls this — never requireAdmin alone —
 * so being signed in is not the same as being allowed. The role is read from
 * the database rather than trusted from the session token, so demoting
 * someone takes effect on their next request, not when their 8-hour session
 * happens to expire.
 */
export async function requirePermission(permission: Permission): Promise<AdminSession | null> {
  const session = await requireAdmin();
  if (!session) return null;

  const user = await db.adminUser.findUnique({
    where: { id: session.adminUserId },
    select: { role: true, isActive: true },
  });
  if (!user?.isActive || !can(user.role, permission)) return null;

  return { ...session, role: user.role };
}

/**
 * Record an admin write.
 *
 * Every mutation goes through here. Logging is intentionally best-effort: an
 * audit failure must not roll back a legitimate price change, but it should be
 * visible in the server logs.
 */
export async function audit(
  actor: { adminUserId: string | null; email: string },
  action: string,
  entityType: string,
  entityId: string,
  changes?: unknown,
): Promise<void> {
  try {
    const h = await headers();
    await db.adminAuditLog.create({
      data: {
        adminUserId: actor.adminUserId,
        actorEmail: actor.email,
        action,
        entityType,
        entityId,
        changes: (changes ?? undefined) as Prisma.InputJsonValue | undefined,
        // The whole chain, not just the first entry: the leftmost value can be
        // supplied by the client, so only the full chain is honest evidence.
        ipAddress: (h.get("x-forwarded-for") || h.get("x-real-ip"))?.slice(0, 200) ?? null,
        userAgent: h.get("user-agent")?.slice(0, 400) ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record", { action, entityType, entityId }, error);
  }
}

/** Console base path. Defaults to something guessable only if unset. */
export function adminPath(): string {
  return process.env.ADMIN_PATH?.replace(/^\/+|\/+$/g, "") || "admin";
}
