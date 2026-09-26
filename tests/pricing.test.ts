import { describe, expect, it } from "vitest";
import { resolveUnitPrice, formatPercent } from "../src/lib/pricing";
import { formatPriceTag, toPaise } from "../src/lib/money";

describe("product discount pricing", () => {
  it("turns 500 at 6% off into 470", () => {
    const r = resolveUnitPrice(toPaise("500"), { active: true, percent: 6 });
    expect(r.pricePaise).toBe(toPaise("470"));
    expect(r.listPaise).toBe(toPaise("500"));
    expect(r.discountPaise).toBe(toPaise("30"));
    expect(r.percentOff).toBe(6);
  });

  it("charges the list price when the toggle is off, whatever the percentage", () => {
    const r = resolveUnitPrice(toPaise("500"), { active: false, percent: 6 });
    expect(r.pricePaise).toBe(toPaise("500"));
    expect(r.percentOff).toBeNull();
  });

  it.each([null, undefined, 0, 100, 150, -5, Number.NaN])(
    "ignores an unusable percentage (%s)",
    (percent) => {
      expect(resolveUnitPrice(toPaise("500"), { active: true, percent }).pricePaise).toBe(toPaise("500"));
    },
  );

  it("rounds to a whole paisa and never lets price + discount drift from list", () => {
    const r = resolveUnitPrice(toPaise("199"), { active: true, percent: 12.5 });
    expect(Number.isInteger(r.pricePaise)).toBe(true);
    expect(r.pricePaise + r.discountPaise).toBe(r.listPaise);
  });

  it("rejects a non-integer list price", () => {
    expect(() => resolveUnitPrice(499.5, { active: true, percent: 5 })).toThrow(RangeError);
  });

  it("formats percentages without trailing zeros", () => {
    expect(formatPercent(6)).toBe("6");
    expect(formatPercent(6.5)).toBe("6.5");
  });
});

describe("price tag format", () => {
  it("renders whole rupees as 470/- and keeps paise when present", () => {
    expect(formatPriceTag(toPaise("470"))).toBe("₹470/-");
    expect(formatPriceTag(toPaise("1499"))).toBe("₹1,499/-");
    expect(formatPriceTag(toPaise("470.50"))).toBe("₹470.50");
  });
});
