import { describe, expect, it } from "vitest";
import { can, type AdminRole, type Permission } from "../src/lib/permissions";

const ALL: Permission[] = [
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
];

// The full expected matrix, written out rather than derived, so a change to
// permissions.ts that widens a role's access fails here and has to be made on
// purpose.
const EXPECTED: Record<AdminRole, Permission[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((p) => p !== "finance:view"),
  FULFILMENT: ["dashboard:view", "orders:view", "orders:write", "products:view", "batches:write"],
  CONTENT: ["dashboard:view", "products:view", "products:write", "reviews:moderate"],
  STAFF: ["dashboard:view"],
};

describe("permission matrix", () => {
  for (const [role, allowed] of Object.entries(EXPECTED) as [AdminRole, Permission[]][]) {
    for (const permission of ALL) {
      const expected = allowed.includes(permission);
      it(`${role} ${expected ? "can" : "cannot"} ${permission}`, () => {
        expect(can(role, permission)).toBe(expected);
      });
    }
  }

  it("fails closed for an unknown role", () => {
    for (const permission of ALL) expect(can("SUPERUSER", permission)).toBe(false);
  });

  it("only the owner sees finance", () => {
    const withFinance = (Object.keys(EXPECTED) as AdminRole[]).filter((r) => can(r, "finance:view"));
    expect(withFinance).toEqual(["OWNER"]);
  });
});
