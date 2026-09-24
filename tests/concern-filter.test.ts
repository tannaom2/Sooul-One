import { describe, expect, it } from "vitest";
import { activeFilter, applyFilter, filterOptions } from "../src/lib/concern-filter";

const categories = [
  { slug: "hair-fall", name: "Hair Fall" },
  { slug: "sleep", name: "Sleep Support" },
  { slug: "pms", name: "PMS & Menopause" },
];
const products = [
  { id: "a", categorySlug: "hair-fall" },
  { id: "b", categorySlug: "hair-fall" },
  { id: "c", categorySlug: "sleep" },
];

describe("concern filter", () => {
  it("offers only categories with products, with counts, in brand order", () => {
    expect(filterOptions(categories, products)).toEqual([
      { slug: "hair-fall", name: "Hair Fall", count: 2 },
      { slug: "sleep", name: "Sleep Support", count: 1 },
    ]);
  });

  it("accepts only an offered category from the URL", () => {
    const options = filterOptions(categories, products);
    expect(activeFilter("sleep", options)).toBe("sleep");
    expect(activeFilter("pms", options)).toBeNull(); // real category, but empty
    expect(activeFilter("__proto__", options)).toBeNull();
    expect(activeFilter(undefined, options)).toBeNull();
  });

  it("filters to the active category, or shows everything", () => {
    expect(applyFilter(products, "hair-fall").map((p) => p.id)).toEqual(["a", "b"]);
    expect(applyFilter(products, null)).toHaveLength(3);
  });
});
