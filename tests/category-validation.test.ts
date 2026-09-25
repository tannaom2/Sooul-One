import { describe, expect, it } from "vitest";
import { categorySlug, checkCategory } from "../src/lib/validation/category";

const input = (name: string, description = "", sortOrder = "") => ({ name, description, sortOrder });

describe("checkCategory", () => {
  it("accepts the kind of names the brands use today", () => {
    for (const name of ["Healthy Namkeen", "Hair Fall", "PMS & Menopause", "Calcium + D3", "Sleep Support"]) {
      expect(checkCategory(input(name)).ok).toBe(true);
    }
  });

  it("refuses a name that would whitelist a medical claim", () => {
    const result = checkCategory(input("Cures hair loss"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/medical claim/);
    expect(checkCategory(input("Sleep Support", "Treats insomnia in a week")).ok).toBe(false);
  });

  it("tidies spaces and checks length and position", () => {
    const ok = checkCategory(input("  Daily   Vitamin ", "  ", "3"));
    expect(ok).toEqual({ ok: true, value: { name: "Daily Vitamin", description: null, sortOrder: 3 } });
    expect(checkCategory(input("A")).ok).toBe(false);
    expect(checkCategory(input("Vitamins", "", "-1")).ok).toBe(false);
    expect(checkCategory(input("Vitamins", "", "1.5")).ok).toBe(false);
    expect(checkCategory(input("Vitamins", "x".repeat(501))).ok).toBe(false);
  });
});

describe("categorySlug", () => {
  it("makes a readable web address", () => {
    expect(categorySlug("PMS & Menopause")).toBe("pms-and-menopause");
    expect(categorySlug("Calcium + D3")).toBe("calcium-d3");
    expect(categorySlug("  Skin, Nail & Hair ")).toBe("skin-nail-and-hair");
  });
});
