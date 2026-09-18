import { describe, expect, it } from "vitest";
import { lintSupplementCopy, SUPPLEMENT_DISCLAIMER } from "../src/lib/compliance/claims";

describe("lintSupplementCopy — therapeutic claims", () => {
  it("passes well-formed structure/function copy", () => {
    const copy =
      "A daily biotin gummy that supports healthy hair and helps maintain normal skin.";
    const result = lintSupplementCopy(copy);
    expect(result.passesAutomatedCheck).toBe(true);
    expect(result.blockingCount).toBe(0);
  });

  it("blocks a cure claim", () => {
    const result = lintSupplementCopy("Cures hair fall in four weeks.");
    expect(result.passesAutomatedCheck).toBe(false);
    expect(result.findings[0].matchedText).toBe("Cures");
  });

  it.each([
    ["Treats PMS symptoms naturally.", "Treats"],
    ["Prevents seasonal illness.", "Prevents"],
    ["Reverses greying from within.", "Reverses"],
    ["Stops hair fall for good.", "Stops"],
    ["A natural remedy for low energy.", "remedy"],
  ])("blocks %j", (copy, expected) => {
    const result = lintSupplementCopy(copy);
    expect(result.passesAutomatedCheck).toBe(false);
    expect(result.findings.some((f) => f.matchedText === expected)).toBe(true);
  });

  it("offers a compliant rewrite where one is obvious", () => {
    const result = lintSupplementCopy("Treats dull skin.");
    expect(result.findings[0].suggestion).toBe("supports");
  });

  it("warns without blocking on proof and speed language", () => {
    const result = lintSupplementCopy("Clinically proven to work in just 7 days.");
    expect(result.passesAutomatedCheck).toBe(true);
    expect(result.warningCount).toBeGreaterThanOrEqual(2);
  });

  it("does not flag a brand's own category names", () => {
    // Section 8.5: "Hair Fall" and "PMS & Menopause" are lawful as category
    // labels. A linter that flags the brand's own navigation gets switched off.
    const copy = "Browse our Hair Fall and PMS & Menopause ranges.";

    expect(lintSupplementCopy(copy).warningCount).toBeGreaterThan(0);
    expect(
      lintSupplementCopy(copy, {
        allowedPhrases: ["Hair Fall", "PMS & Menopause"],
      }).findings,
    ).toHaveLength(0);
  });

  it("still catches a therapeutic verb sitting beside an allowed category name", () => {
    const result = lintSupplementCopy("Our Hair Fall range cures thinning.", {
      allowedPhrases: ["Hair Fall"],
    });
    expect(result.passesAutomatedCheck).toBe(false);
    expect(result.findings[0].matchedText).toBe("cures");
  });

  it("reports findings in document order with accurate offsets", () => {
    const copy = "Supports immunity. Treats colds. Cures fatigue.";
    const result = lintSupplementCopy(copy);

    const indices = result.findings.map((f) => f.index);
    expect([...indices]).toEqual([...indices].sort((a, b) => a - b));

    for (const f of result.findings) {
      expect(copy.slice(f.index, f.index + f.matchedText.length)).toBe(f.matchedText);
    }
  });

  it("catches every violation, not just the first", () => {
    const result = lintSupplementCopy("Treats acne, cures dryness and prevents ageing.");
    expect(result.blockingCount).toBe(3);
  });

  it("is case-insensitive", () => {
    expect(lintSupplementCopy("CURES everything").passesAutomatedCheck).toBe(false);
  });

  it("handles empty copy without throwing", () => {
    expect(lintSupplementCopy("").findings).toHaveLength(0);
  });
});

describe("SUPPLEMENT_DISCLAIMER", () => {
  it("names the Indian regulator's framing, not the US FDA construction", () => {
    expect(SUPPLEMENT_DISCLAIMER).not.toMatch(/FDA/i);
    expect(SUPPLEMENT_DISCLAIMER).toMatch(/not intended to diagnose, treat, cure or prevent/i);
  });

  it("carries the do-not-exceed line", () => {
    expect(SUPPLEMENT_DISCLAIMER).toMatch(/do not exceed/i);
  });
});
