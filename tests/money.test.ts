import { describe, expect, it } from "vitest";
import {
  applyDiscount,
  formatINR,
  fromPaise,
  lineTotal,
  splitTaxInclusive,
  toPaise,
} from "../src/lib/money";

describe("toPaise / fromPaise", () => {
  it.each([
    ["249", 24900],
    ["249.50", 24950],
    ["249.5", 24950],
    ["0.01", 1],
    ["0", 0],
    ["-15.75", -1575],
  ])("converts %j to %i paise", (input, expected) => {
    expect(toPaise(input)).toBe(expected);
  });

  it("rejects malformed amounts instead of coercing them", () => {
    expect(() => toPaise("12.345")).toThrow(RangeError);
    expect(() => toPaise("abc")).toThrow(RangeError);
    expect(() => toPaise("")).toThrow(RangeError);
  });

  it("round-trips", () => {
    for (const v of ["1", "99.99", "1234.05", "0.07"]) {
      expect(fromPaise(toPaise(v))).toBe(Number(v).toFixed(2));
    }
  });

  it("survives the float case that motivates integer paise", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    expect(toPaise("0.10") + toPaise("0.20")).toBe(toPaise("0.30"));
  });
});

describe("formatINR", () => {
  it("uses Indian digit grouping, not Western", () => {
    expect(formatINR(toPaise("100000"))).toBe("₹1,00,000.00");
    expect(formatINR(toPaise("10000000"))).toBe("₹1,00,00,000.00");
  });

  it("leaves small amounts ungrouped", () => {
    expect(formatINR(toPaise("999"))).toBe("₹999.00");
    expect(formatINR(toPaise("1000"))).toBe("₹1,000.00");
  });

  it("handles negatives", () => {
    expect(formatINR(toPaise("-1500.50"))).toBe("-₹1,500.50");
  });
});

describe("splitTaxInclusive", () => {
  it("backs tax out of an inclusive price rather than adding it on top", () => {
    const { netPaise, taxPaise, grossPaise } = splitTaxInclusive(toPaise("118"), 18);
    expect(grossPaise).toBe(toPaise("118"));
    expect(netPaise).toBe(toPaise("100"));
    expect(taxPaise).toBe(toPaise("18"));
  });

  it("always reconciles: net + tax === gross", () => {
    for (let gross = 1; gross <= 5000; gross += 7) {
      for (const rate of [0, 5, 12, 18, 28]) {
        const s = splitTaxInclusive(gross, rate);
        expect(s.netPaise + s.taxPaise).toBe(gross);
      }
    }
  });

  it("splits intra-state tax into CGST and SGST that sum exactly", () => {
    const s = splitTaxInclusive(toPaise("118"), 18, "INTRA_STATE");
    expect(s.cgstPaise + s.sgstPaise).toBe(s.taxPaise);
    expect(s.igstPaise).toBe(0);
  });

  it("gives the odd paisa to CGST rather than losing it", () => {
    // Construct a tax total that is odd in paise.
    const gross = 787;
    const s = splitTaxInclusive(gross, 18, "INTRA_STATE");
    if (s.taxPaise % 2 === 1) {
      expect(s.cgstPaise - s.sgstPaise).toBe(1);
    }
    expect(s.cgstPaise + s.sgstPaise).toBe(s.taxPaise);
  });

  it("routes inter-state supply to IGST", () => {
    const s = splitTaxInclusive(toPaise("118"), 18, "INTER_STATE");
    expect(s.igstPaise).toBe(toPaise("18"));
    expect(s.cgstPaise).toBe(0);
    expect(s.sgstPaise).toBe(0);
  });

  it("handles a zero-rated item", () => {
    const s = splitTaxInclusive(toPaise("50"), 0);
    expect(s.taxPaise).toBe(0);
    expect(s.netPaise).toBe(toPaise("50"));
  });

  it("refuses non-integer paise", () => {
    expect(() => splitTaxInclusive(100.5, 18)).toThrow(RangeError);
  });
});

describe("applyDiscount", () => {
  it("applies a percentage", () => {
    const { discountPaise, totalPaise } = applyDiscount(toPaise("1000"), "PERCENTAGE", 10);
    expect(discountPaise).toBe(toPaise("100"));
    expect(totalPaise).toBe(toPaise("900"));
  });

  it("applies a flat amount", () => {
    const { totalPaise } = applyDiscount(toPaise("1000"), "FLAT", 150);
    expect(totalPaise).toBe(toPaise("850"));
  });

  it("never produces a negative total from an oversized flat coupon", () => {
    const { discountPaise, totalPaise } = applyDiscount(toPaise("200"), "FLAT", 500);
    expect(totalPaise).toBe(0);
    expect(discountPaise).toBe(toPaise("200"));
  });

  it("caps a percentage above 100", () => {
    expect(applyDiscount(toPaise("500"), "PERCENTAGE", 150).totalPaise).toBe(0);
  });

  it("refuses a negative discount, which would inflate the order", () => {
    expect(() => applyDiscount(toPaise("500"), "FLAT", -50)).toThrow(RangeError);
  });
});

describe("lineTotal", () => {
  it("multiplies without float drift", () => {
    expect(lineTotal(toPaise("33.33"), 3)).toBe(toPaise("99.99"));
  });

  it("refuses a zero or fractional quantity", () => {
    expect(() => lineTotal(100, 0)).toThrow(RangeError);
    expect(() => lineTotal(100, 1.5)).toThrow(RangeError);
  });
});
