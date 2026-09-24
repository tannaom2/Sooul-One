import { describe, expect, it } from "vitest";
import { inServicePincode, isServiceable } from "../src/lib/checkout/service-area";
import { zoneForPincode } from "../src/lib/checkout/delivery";

describe("service area: Gujarat only", () => {
  it("accepts Gujarat pincodes with the Gujarat state", () => {
    expect(isServiceable("380015", "Gujarat")).toBe(true); // Ahmedabad
    expect(isServiceable("395007", " gujarat ")).toBe(true); // Surat, typed loosely
    expect(isServiceable("360001", "Gujarat", "Gujarat")).toBe(true); // Rajkot, confirmed by India Post
  });

  it("refuses pincodes outside the 36-39 range, whatever state is typed", () => {
    expect(isServiceable("411001", "Gujarat")).toBe(false); // Pune
    expect(isServiceable("110001", "Gujarat")).toBe(false);
    expect(inServicePincode("3800")).toBe(false);
  });

  it("trusts India Post's state over the typed one", () => {
    // Silvassa: a 396 pincode that is not in Gujarat.
    expect(isServiceable("396230", "Gujarat", "Dadra & Nagar Haveli and Daman & Diu")).toBe(false);
    expect(isServiceable("380015", "Maharashtra", "Gujarat")).toBe(true);
  });

  it("refuses a Gujarat pincode typed with another state when the directory can't confirm", () => {
    expect(isServiceable("380015", "Rajasthan")).toBe(false);
  });
});

describe("delivery zones within Gujarat", () => {
  it("treats the big cities as metro and the rest of Gujarat as the second zone", () => {
    for (const pin of ["380015", "382010", "395007", "390001", "360001"]) expect(zoneForPincode(pin)).toBe("METRO");
    for (const pin of ["370001", "361001", "364001"]) expect(zoneForPincode(pin)).toBe("TIER_2");
  });

  it("leaves unserved pincodes in the slowest zone", () => {
    expect(zoneForPincode("411001")).toBe("REST_OF_INDIA");
  });
});
