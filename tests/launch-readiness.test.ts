import { describe, expect, it } from "vitest";
import {
  evaluateReadiness,
  gateEnforced,
  looksLikeTestAccount,
  regionFromDatabaseUrl,
  type ReadinessFacts,
} from "../src/lib/launch-readiness";

const ready: ReadinessFacts = {
  business: {
    legalName: "Example Foods Pvt Ltd",
    registeredAddress: "Plot 1, GIDC, Ahmedabad",
    gstin: "24ABCDE1234F1Z5",
    fssaiLicence: "10726001000123",
    customerCarePhone: null,
    customerCareEmail: "care@example.in",
    grievanceOfficerName: "A. Shah",
    grievanceOfficerEmail: "grievance@example.in",
    grievanceOfficerPhone: null,
  },
  draftPolicies: [],
  liveProducts: 12,
  liveProductsMissingDeclarations: [],
  liveProductsWithoutPhotos: [],
  emailConfigured: true,
  cronConfigured: true,
  onlinePayments: false,
  errorMonitoring: false,
  databaseRegion: "ap-southeast-1",
  testAdmins: [],
  activeOwners: 1,
};

describe("evaluateReadiness", () => {
  it("opens orders when everything required is done, even with recommendations left", () => {
    const r = evaluateReadiness(ready);
    expect(r.blockers).toEqual([]);
    const warnings = r.items.filter((i) => i.status === "warning").map((i) => i.id);
    expect(warnings).toEqual(expect.arrayContaining(["payments", "monitoring", "second-owner"]));
  });

  it("blocks on each missing legal detail, draft policy, incomplete product, missing email or test admin", () => {
    const r = evaluateReadiness({
      ...ready,
      business: { ...ready.business, gstin: null, grievanceOfficerEmail: null },
      draftPolicies: ["refunds"],
      liveProductsMissingDeclarations: ["Masala Chana"],
      emailConfigured: false,
      testAdmins: ["manual-test@soulone.test"],
    });
    expect(r.blockers.map((b) => b.id).sort()).toEqual(["declarations", "email", "grievance", "gstin", "policies", "test-admins"]);
    expect(r.blockers.find((b) => b.id === "declarations")?.detail).toContain("Masala Chana");
  });

  it("blocks with no products on sale at all", () => {
    expect(evaluateReadiness({ ...ready, liveProducts: 0 }).blockers.map((b) => b.id)).toEqual(["live-products"]);
  });

  it("warns, without blocking, when the database is far from Gujarat", () => {
    const r = evaluateReadiness({ ...ready, databaseRegion: "us-east-2" });
    expect(r.items.find((i) => i.id === "db-region")?.status).toBe("warning");
    expect(r.blockers).toEqual([]);
  });

  it("never blocks on things only a person can confirm", () => {
    const manual = evaluateReadiness(ready).items.filter((i) => i.status === "manual");
    expect(manual.length).toBeGreaterThan(0);
    expect(manual.every((i) => !i.blocking)).toBe(true);
  });
});

describe("gateEnforced", () => {
  it("applies only on the public https site", () => {
    expect(gateEnforced("https://sooulone.in", undefined)).toBe(true);
    expect(gateEnforced("http://localhost:3000", undefined)).toBe(false);
    expect(gateEnforced("https://localhost:3000", undefined)).toBe(false);
    expect(gateEnforced(undefined, undefined)).toBe(false);
  });

  it("can be switched off by the owner in an emergency", () => {
    expect(gateEnforced("https://sooulone.in", "off")).toBe(false);
  });
});

describe("helpers", () => {
  it("reads the region from a Neon host", () => {
    expect(regionFromDatabaseUrl("postgresql://u:p@ep-x-pooler.c-6.us-east-2.aws.neon.tech/db")).toBe("us-east-2");
    expect(regionFromDatabaseUrl("postgresql://u:p@localhost:5432/db")).toBeNull();
  });

  it("recognises test accounts but not real ones", () => {
    expect(looksLikeTestAccount("manual-test@soulone.test")).toBe(true);
    expect(looksLikeTestAccount("someone@example.com")).toBe(true);
    expect(looksLikeTestAccount("tannaom2@gmail.com")).toBe(false);
  });
});
