import { describe, expect, it } from "vitest";
import { isSellable, priceChangeNote, unavailableFixes } from "../src/lib/basket-rules";

const rupees = (p: number) => `₹${p / 100}`;

describe("isSellable", () => {
  it("needs the product, brand and category all switched on", () => {
    const on = { isActive: true };
    expect(isSellable({ isActive: true, brand: on, category: on })).toBe(true);
    expect(isSellable({ isActive: false, brand: on, category: on })).toBe(false);
    expect(isSellable({ isActive: true, brand: { isActive: false }, category: on })).toBe(false);
    expect(isSellable({ isActive: true, brand: on, category: { isActive: false } })).toBe(false);
  });

  it("doesn't block when brand or category weren't loaded", () => {
    expect(isSellable({ isActive: true })).toBe(true);
  });
});

describe("priceChangeNote", () => {
  it("says nothing when the price hasn't moved or wasn't recorded", () => {
    expect(priceChangeNote(19900, 19900, rupees)).toBeNull();
    expect(priceChangeNote(null, 19900, rupees)).toBeNull();
  });

  it("names both prices when it went up or down", () => {
    expect(priceChangeNote(19900, 24900, rupees)).toBe("Price has gone up since you added this: was ₹199, now ₹249.");
    expect(priceChangeNote(24900, 19900, rupees)).toBe("Price has dropped since you added this: was ₹249, now ₹199.");
  });
});

describe("unavailableFixes", () => {
  it("removes lines that can't ship and trims ones that partly can", () => {
    const fixes = unavailableFixes([
      { itemId: "ok", quantity: 2, quantityAvailable: 2 },
      { itemId: "gone", quantity: 3, quantityAvailable: 0 },
      { itemId: "short", quantity: 5, quantityAvailable: 2 },
    ]);
    expect(fixes.remove).toEqual(["gone"]);
    expect(fixes.trim).toEqual([{ itemId: "short", quantity: 2 }]);
  });

  it("leaves a healthy basket alone", () => {
    expect(unavailableFixes([{ itemId: "a", quantity: 1, quantityAvailable: 1 }])).toEqual({ remove: [], trim: [] });
  });
});
