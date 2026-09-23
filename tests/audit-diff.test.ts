import { describe, expect, it } from "vitest";
import { diffFields } from "../src/lib/audit-diff";

// Stand-in for Prisma's Decimal: an object whose toString is the number.
const decimal = (s: string) => ({ toString: () => s });

describe("diffFields", () => {
  it("reports only fields that changed", () => {
    expect(diffFields({ name: "Namkeen", basePrice: decimal("100") }, { name: "Namkeen", basePrice: "90" })).toEqual({
      basePrice: { from: 100, to: 90 },
    });
  });

  it("does not report a price as changed just because its type differs", () => {
    expect(diffFields({ basePrice: decimal("100.00") }, { basePrice: "100" })).toEqual({});
    expect(diffFields({ taxRatePercent: decimal("18") }, { taxRatePercent: 18 })).toEqual({});
  });

  it("treats null, undefined and empty string as the same 'no value'", () => {
    expect(diffFields({ hsnCode: null }, { hsnCode: undefined })).toEqual({});
    expect(diffFields({ compareAtPrice: null }, { compareAtPrice: "" })).toEqual({});
  });

  it("records a value being cleared", () => {
    expect(diffFields({ compareAtPrice: decimal("120") }, { compareAtPrice: null })).toEqual({
      compareAtPrice: { from: 120, to: null },
    });
  });

  it("compares arrays by content", () => {
    expect(diffFields({ allergens: ["milk"] }, { allergens: ["milk"] })).toEqual({});
    expect(diffFields({ allergens: ["milk"] }, { allergens: ["milk", "nuts"] })).toEqual({
      allergens: { from: ["milk"], to: ["milk", "nuts"] },
    });
  });

  it("records booleans and status changes", () => {
    expect(diffFields({ discountActive: false, status: "PAID" }, { discountActive: true, status: "SHIPPED" })).toEqual({
      discountActive: { from: false, to: true },
      status: { from: "PAID", to: "SHIPPED" },
    });
  });

  it("only compares keys present in the new values", () => {
    expect(diffFields({ name: "A", untouched: 1 }, { name: "B" })).toEqual({ name: { from: "A", to: "B" } });
  });
});
