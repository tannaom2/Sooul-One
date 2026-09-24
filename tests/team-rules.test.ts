import { describe, expect, it } from "vitest";
import { isValidSetupKey, teamChangeBlocked } from "../src/lib/team-rules";

const owner = { id: "owner-2", role: "OWNER", isActive: true };
const staff = { id: "staff-1", role: "FULFILMENT", isActive: true };

describe("teamChangeBlocked", () => {
  it("blocks every change to your own account", () => {
    for (const change of [{ role: "STAFF" }, { isActive: false }, { resetAccess: true }]) {
      expect(teamChangeBlocked({ actorId: "me", target: { ...owner, id: "me" }, change, activeOwners: 3 })).toMatch(
        /own account/,
      );
    }
  });

  it("allows ordinary changes to someone else", () => {
    expect(teamChangeBlocked({ actorId: "me", target: staff, change: { role: "MANAGER" }, activeOwners: 1 })).toBeNull();
    expect(teamChangeBlocked({ actorId: "me", target: staff, change: { isActive: false }, activeOwners: 1 })).toBeNull();
    expect(teamChangeBlocked({ actorId: "me", target: staff, change: { resetAccess: true }, activeOwners: 1 })).toBeNull();
  });

  it("never leaves the store without an active owner", () => {
    expect(teamChangeBlocked({ actorId: "me", target: owner, change: { role: "MANAGER" }, activeOwners: 1 })).toMatch(
      /at least one active owner/,
    );
    expect(teamChangeBlocked({ actorId: "me", target: owner, change: { isActive: false }, activeOwners: 1 })).toMatch(
      /at least one active owner/,
    );
  });

  it("allows demoting an owner while another active owner remains", () => {
    expect(teamChangeBlocked({ actorId: "me", target: owner, change: { role: "MANAGER" }, activeOwners: 2 })).toBeNull();
    expect(teamChangeBlocked({ actorId: "me", target: owner, change: { isActive: false }, activeOwners: 2 })).toBeNull();
  });

  it("doesn't count keeping someone an owner, or touching an inactive owner, as removing one", () => {
    expect(teamChangeBlocked({ actorId: "me", target: owner, change: { role: "OWNER" }, activeOwners: 1 })).toBeNull();
    const inactive = { ...owner, isActive: false };
    expect(teamChangeBlocked({ actorId: "me", target: inactive, change: { role: "STAFF" }, activeOwners: 1 })).toBeNull();
  });
});

describe("isValidSetupKey", () => {
  it("accepts base32 keys", () => {
    expect(isValidSetupKey("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP")).toBe(true);
  });

  it("refuses anything else", () => {
    for (const bad of ["", "short", "jbswy3dpehpk3pxpjbswy3dpehpk3pxp", "JBSWY3DPEHPK3PXP 1", "A".repeat(65)]) {
      expect(isValidSetupKey(bad)).toBe(false);
    }
  });
});
