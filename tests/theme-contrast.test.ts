import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.1 AA for the design tokens, read from the real stylesheet, so a
 * palette change that breaks contrast fails here rather than on a shopper's
 * screen. Text needs 4.5:1; control edges and the primary button against
 * the page need 3:1 (1.4.11). The night surfaces must also step up in
 * lightness, since shadows don't show on dark.
 */

const css = readFileSync(join(__dirname, "..", "src", "app", "globals.css"), "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

const day = tokens(/:root \{([\s\S]*?)\n\}/.exec(css)![1]);
const night = { ...day, ...tokens(/:root\[data-theme="dark"\] \{([\s\S]*?)\n {2}\}/.exec(css)![1]) };

function luminance(hex: string): number {
  const [r, g, b] = hex.slice(1).match(/../g)!.map((h) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ["text-primary", "text-secondary", "text-muted", "mark-veg", "brand-truestore-text", "brand-womanaxis", "brand-kidsvault", "brand-manrituals", "feedback-alert", "feedback-caution"];
const SURFACES = ["bg-base", "bg-surface", "bg-muted", "bg-elevated"];

describe.each([
  ["Day", day],
  ["Night", night],
])("%s palette", (_name, t) => {
  it("has every token the checks need", () => {
    for (const key of [...TEXT, ...SURFACES, "border-input", "primary", "text-on-primary", "bg-inverse", "text-on-inverse"]) expect(t[key], key).toMatch(/^#/);
  });

  it.each(TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg])))("%s on %s reads at 4.5:1", (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("puts readable text on filled buttons and strips", () => {
    expect(contrast(t["text-on-primary"], t["primary"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["text-on-inverse"], t["bg-inverse"])).toBeGreaterThanOrEqual(4.5);
    // White or dark text on the deepened turmeric chip.
    expect(contrast(t["text-on-accent"], t["brand-truestore-text"])).toBeGreaterThanOrEqual(4.5);
  });

  it("gives controls a visible edge (3:1)", () => {
    for (const bg of ["bg-base", "bg-surface", "bg-elevated"]) expect(contrast(t["border-input"], t[bg])).toBeGreaterThanOrEqual(3);
    expect(contrast(t["primary"], t["bg-base"])).toBeGreaterThanOrEqual(3);
  });
});

describe("Tailwind token names", () => {
  it("never gives a colour the name of a font size (text-base would become both)", () => {
    const theme = /@theme \{([\s\S]*?)\n\}/.exec(css)![1];
    const colours = new Set([...theme.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]));
    const sizes = [...theme.matchAll(/--text-([a-z0-9-]+):/g)].map((m) => m[1]);
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((s) => colours.has(s))).toEqual([]);
  });
});

describe("Night mode's rules", () => {
  it("never uses pure black or pure white", () => {
    for (const key of ["bg-base", "bg-surface", "bg-elevated", "text-primary"]) expect(["#000000", "#ffffff"]).not.toContain(night[key]);
  });

  it("lifts raised surfaces by lightness, since shadows don't show", () => {
    expect(luminance(night["bg-surface"])).toBeGreaterThan(luminance(night["bg-base"]));
    expect(luminance(night["bg-elevated"])).toBeGreaterThan(luminance(night["bg-surface"]));
    expect(contrast(night["bg-elevated"], night["bg-base"])).toBeGreaterThanOrEqual(1.2);
  });

  it("tones the primary button down from the text colour, so it doesn't glare", () => {
    expect(luminance(night["primary"])).toBeLessThan(luminance(night["text-primary"]));
  });
});
