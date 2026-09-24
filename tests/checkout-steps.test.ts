import { describe, expect, it } from "vitest";
import { EMPTY_FORM, firstIncompleteStep, normalise, stepSummary, validateStep, type CheckoutForm } from "../src/lib/checkout/steps";
import { parsePostOffice } from "../src/lib/checkout/pincode";

const complete: CheckoutForm = {
  ...EMPTY_FORM,
  phone: "9876543210",
  email: "a@b.in",
  postalCode: "411001",
  name: "Asha Rao",
  line1: "12 MG Road",
  city: "Pune",
  state: "Maharashtra",
};

describe("validateStep", () => {
  it("checks only the current step's fields", () => {
    expect(validateStep("contact", { ...EMPTY_FORM, phone: "9876543210", email: "a@b.in" })).toEqual({});
    expect(Object.keys(validateStep("address", { ...EMPTY_FORM, phone: "9876543210" }))).toEqual(
      expect.arrayContaining(["postalCode", "name", "line1", "city", "state"]),
    );
  });

  it("uses the server's own messages", () => {
    expect(validateStep("contact", { ...complete, phone: "12345" }).phone).toMatch(/10-digit Indian mobile/);
  });
});

describe("normalise", () => {
  it("accepts a phone typed with +91, spaces or a leading 0", () => {
    expect(normalise({ ...complete, phone: "+91 98765 43210" }).phone).toBe("9876543210");
    expect(normalise({ ...complete, phone: "09876543210" }).phone).toBe("9876543210");
    expect(validateStep("contact", { ...complete, phone: "+91 98765-43210" })).toEqual({});
  });
});

describe("firstIncompleteStep and stepSummary", () => {
  it("resumes at the first unfinished step", () => {
    expect(firstIncompleteStep(EMPTY_FORM)).toBe("contact");
    expect(firstIncompleteStep({ ...complete, line1: "" })).toBe("address");
    expect(firstIncompleteStep(complete)).toBe("payment");
  });

  it("summarises finished steps in one line", () => {
    expect(stepSummary("contact", complete)).toBe("9876543210 · a@b.in");
    expect(stepSummary("address", complete)).toBe("Asha Rao, 12 MG Road, Pune, 411001");
  });
});

describe("parsePostOffice", () => {
  const office = (District: string, State: string) => ({ District, State, Name: "x" });

  it("returns the district and state", () => {
    expect(parsePostOffice([{ Status: "Success", PostOffice: [office("Pune", "Maharashtra"), office("Pune", "Maharashtra")] }])).toEqual({
      city: "Pune",
      state: "Maharashtra",
    });
  });

  it("takes the most common pair when an office from elsewhere is listed", () => {
    const r = parsePostOffice([{ Status: "Success", PostOffice: [office("Thane", "Maharashtra"), office("Mumbai", "Maharashtra"), office("Mumbai", "Maharashtra")] }]);
    expect(r?.city).toBe("Mumbai");
  });

  it("returns null for unknown pincodes and malformed replies", () => {
    expect(parsePostOffice([{ Status: "Error", PostOffice: null }])).toBeNull();
    expect(parsePostOffice({ nope: true })).toBeNull();
    expect(parsePostOffice([])).toBeNull();
  });
});
