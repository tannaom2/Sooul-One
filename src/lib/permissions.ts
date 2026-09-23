/**
 * Role → permission matrix for the owner console.
 *
 * The single source of truth for who may do what. Server-side checks
 * (requirePermission in auth.ts) enforce it; the navigation only uses it to
 * hide links a role can't use, which is convenience, not security.
 *
 * Least privilege: a role gets exactly what its job needs. STAFF is the
 * legacy default and is view-only.
 */

export type AdminRole = "OWNER" | "MANAGER" | "FULFILMENT" | "CONTENT" | "STAFF";

export type Permission =
  | "dashboard:view"
  | "orders:view"
  | "orders:write"
  | "products:view"
  | "products:write"
  /** Base price, was-price, discount, GST rate — separate from copy edits. */
  | "products:pricing"
  | "batches:write"
  | "bundles:write"
  | "reviews:moderate"
  /** Revenue figures, analytics, funnel, payment reconciliation. */
  | "finance:view"
  | "stores:write";

const MATRIX: Record<AdminRole, readonly Permission[]> = {
  OWNER: [
    "dashboard:view",
    "orders:view",
    "orders:write",
    "products:view",
    "products:write",
    "products:pricing",
    "batches:write",
    "bundles:write",
    "reviews:moderate",
    "finance:view",
    "stores:write",
  ],
  MANAGER: [
    "dashboard:view",
    "orders:view",
    "orders:write",
    "products:view",
    "products:write",
    "products:pricing",
    "batches:write",
    "bundles:write",
    "reviews:moderate",
    "stores:write",
  ],
  FULFILMENT: ["dashboard:view", "orders:view", "orders:write", "products:view", "batches:write"],
  CONTENT: ["dashboard:view", "products:view", "products:write", "reviews:moderate"],
  STAFF: ["dashboard:view"],
};

export function can(role: string, permission: Permission): boolean {
  return (MATRIX[role as AdminRole] ?? []).includes(permission);
}
