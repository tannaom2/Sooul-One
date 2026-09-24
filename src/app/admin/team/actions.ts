"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, hashPassword, newTemporaryPassword, requirePermission } from "@/lib/auth";
import { ROLES, isRole } from "@/lib/permissions";
import { teamChangeBlocked, type TeamChange } from "@/lib/team-rules";

export interface TeamResult {
  ok: boolean;
  message?: string;
  /** Shown to the owner once, to pass on privately. Never stored in plain text. */
  temporaryPassword?: string;
  email?: string;
}

const NOT_ALLOWED = "Only an owner can manage the team.";
const label = (role: string) => ROLES.find((r) => r.role === role)?.label ?? role;

export async function addTeamMember(_prev: TeamResult, form: FormData): Promise<TeamResult> {
  const session = await requirePermission("team:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const role = String(form.get("role") ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (!name || name.length > 100) return { ok: false, message: "Enter their name (up to 100 characters)." };
  if (!isRole(role)) return { ok: false, message: "Choose a role." };

  const temporaryPassword = newTemporaryPassword();
  try {
    const user = await db.adminUser.create({
      data: { email, name, role, passwordHash: await hashPassword(temporaryPassword), mfaSecret: null },
    });
    await audit(session, "TEAM_ADD", "AdminUser", user.id, { email, role });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, message: "Someone with that email is already on the team." };
    }
    throw error;
  }

  revalidatePath("/admin/team");
  return { ok: true, message: `${name} added as ${label(role)}.`, temporaryPassword, email };
}

/**
 * Applies one change to someone else's account. The owner count is read in
 * the same serializable transaction as the write, so two owners demoting each
 * other at the same moment can't leave the store with none.
 */
async function applyChange(
  targetId: string,
  change: TeamChange,
  data: (target: { sessionVersion: number }) => Prisma.AdminUserUpdateInput,
): Promise<
  | { ok: false; message: string }
  | { ok: true; session: { adminUserId: string; email: string }; before: { role: string; isActive: boolean; email: string } }
> {
  const session = await requirePermission("team:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  try {
    return await db.$transaction(
      async (tx) => {
        const target = await tx.adminUser.findUnique({ where: { id: targetId } });
        if (!target) return { ok: false as const, message: "That person is no longer on the team." };
        const activeOwners = await tx.adminUser.count({ where: { role: "OWNER", isActive: true } });
        const blocked = teamChangeBlocked({ actorId: session.adminUserId, target, change, activeOwners });
        if (blocked) return { ok: false as const, message: blocked };

        await tx.adminUser.update({ where: { id: targetId }, data: data(target) });
        return { ok: true as const, session, before: target };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    // Serialization failure: someone else changed the team at the same moment.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return { ok: false, message: "Someone else changed the team at the same time. Try again." };
    }
    throw error;
  }
}

export async function changeRole(_prev: TeamResult, form: FormData): Promise<TeamResult> {
  const session = await requirePermission("team:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  const id = String(form.get("id") ?? "");
  const role = String(form.get("role") ?? "");
  if (!isRole(role)) return { ok: false, message: "Choose a role." };

  const result = await applyChange(id, { role }, () => ({ role }));
  if (!result.ok) return result;
  if (result.before.role === role) return { ok: true, message: "No change." };

  await audit(result.session, "TEAM_ROLE", "AdminUser", id, { email: result.before.email, role: { from: result.before.role, to: role } });
  revalidatePath("/admin/team");
  return { ok: true, message: `Now ${label(role)}. Takes effect on their next click.` };
}

export async function setActive(_prev: TeamResult, form: FormData): Promise<TeamResult> {
  const session = await requirePermission("team:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  const id = String(form.get("id") ?? "");
  const isActive = form.get("isActive") === "true";

  // Deactivating also bumps the session version, so reactivating later
  // doesn't revive a session left open somewhere.
  const result = await applyChange(id, { isActive }, (t) => ({
    isActive,
    ...(!isActive && { sessionVersion: t.sessionVersion + 1 }),
  }));
  if (!result.ok) return result;

  await audit(result.session, isActive ? "TEAM_REACTIVATE" : "TEAM_DEACTIVATE", "AdminUser", id, {
    email: result.before.email,
  });
  revalidatePath("/admin/team");
  return { ok: true, message: isActive ? "Reactivated." : "Deactivated and signed out everywhere." };
}

export async function resetAccess(_prev: TeamResult, form: FormData): Promise<TeamResult> {
  const session = await requirePermission("team:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  const id = String(form.get("id") ?? "");
  const temporaryPassword = newTemporaryPassword();
  // Hashed before the transaction: bcrypt is deliberately slow.
  const passwordHash = await hashPassword(temporaryPassword);

  const result = await applyChange(id, { resetAccess: true }, (t) => ({
    passwordHash,
    mfaSecret: null,
    sessionVersion: t.sessionVersion + 1,
  }));
  if (!result.ok) return result;

  await audit(result.session, "TEAM_RESET_ACCESS", "AdminUser", id, { email: result.before.email });
  revalidatePath("/admin/team");
  return {
    ok: true,
    message: "Access reset and signed out everywhere.",
    temporaryPassword,
    email: result.before.email,
  };
}
