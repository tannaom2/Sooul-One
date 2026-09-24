import { describe, expect, it } from "vitest";
import { businessProfileSchema } from "../src/lib/validation/business";

const errors = (input: Record<string, unknown>) => {
  const r = businessProfileSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => String(i.path[0]));
};

describe("businessProfileSchema", () => {
  it("accepts an empty profile, since details arrive over time", () => {
    expect(businessProfileSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a complete Gujarat profile and normalises the GSTIN to capitals", () => {
    const r = businessProfileSchema.safeParse({
      legalName: "Example Foods Pvt Ltd",
      gstin: "24abcde1234f1z5",
      fssaiLicence: "10726001000123",
      customerCarePhone: "+91 98765 43210",
      customerCareEmail: "care@example.in",
      grievanceOfficerName: "A. Shah",
      grievanceOfficerEmail: "grievance@example.in",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.gstin).toBe("24ABCDE1234F1Z5");
  });

  it("refuses a GSTIN from another state, since invoices assume a Gujarat registration", () => {
    expect(errors({ gstin: "27ABCDE1234F1Z5" })).toEqual(["gstin"]); // Maharashtra
  });

  it("checks formats: GSTIN shape, 14-digit FSSAI number, phones and emails", () => {
    expect(errors({ gstin: "24ABCDE1234" })).toContain("gstin");
    expect(errors({ fssaiLicence: "12345" })).toContain("fssaiLicence");
    expect(errors({ customerCarePhone: "call us" })).toContain("customerCarePhone");
    expect(errors({ grievanceOfficerEmail: "not-an-email" })).toContain("grievanceOfficerEmail");
  });
});
