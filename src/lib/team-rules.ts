/**
 * The rules that keep Team page changes from locking the store out. Pure, so
 * they're tested directly; the actions in src/app/admin/team/actions.ts call
 * them inside a transaction with a fresh owner count.
 */

export type TeamChange = { role?: string; isActive?: boolean; resetAccess?: boolean };

export function teamChangeBlocked(input: {
  actorId: string;
  target: { id: string; role: string; isActive: boolean };
  change: TeamChange;
  /** Active owners right now, including the target if they are one. */
  activeOwners: number;
}): string | null {
  const { actorId, target, change, activeOwners } = input;

  // Your own role, status and access go through the normal sign-in flow —
  // changing them here is how an owner demotes or locks themselves out.
  if (target.id === actorId) return "You can't change your own account here.";

  const stopsBeingActiveOwner =
    target.role === "OWNER" &&
    target.isActive &&
    ((change.role !== undefined && change.role !== "OWNER") || change.isActive === false);
  if (stopsBeingActiveOwner && activeOwners <= 1) {
    return "The store needs at least one active owner. Make someone else an owner first.";
  }

  return null;
}

/** Base32 TOTP setup key as otplib generates it. Anything else is refused. */
export function isValidSetupKey(key: string): boolean {
  return /^[A-Z2-7]{16,64}$/.test(key);
}

export const MIN_PASSWORD_LENGTH = 12;
