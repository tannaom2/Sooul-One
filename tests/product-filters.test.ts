import { describe, expect, it } from "vitest";
import { parseProductFilters, productFiltersHref } from "../src/lib/product-filters";

const BRANDS = ["brand_a", "brand_b"];

describe("parseProductFilters", () => {
  it("defaults when nothing is given", () => {
    expect(parseProductFilters({}, BRANDS)).toEqual({ view: "all", q: "", brand: undefined, page: 1 });
  });

  it("accepts known views and real brand ids", () => {
    expect(parseProductFilters({ view: "low", brand: "brand_b" }, BRANDS)).toMatchObject({ view: "low", brand: "brand_b" });
  });

  it("ignores unknown views and brand ids that don't exist", () => {
    const f = parseProductFilters({ view: "constructor", brand: "brand_x' OR 1=1" }, BRANDS);
    expect(f.view).toBe("all");
    expect(f.brand).toBeUndefined();
  });

  it("clamps the page and caps the search", () => {
    const f = parseProductFilters({ page: "0", q: ` ${"y".repeat(200)} ` }, BRANDS);
    expect(f.page).toBe(1);
    expect(f.q).toHaveLength(100);
  });
});

describe("productFiltersHref", () => {
  it("drops defaults and keeps the rest", () => {
    expect(productFiltersHref({ view: "all", page: 1 })).toBe("/admin/products");
    expect(productFiltersHref({ view: "out", q: "tea", brand: "brand_a", page: 3 })).toBe(
      "/admin/products?view=out&q=tea&brand=brand_a&page=3",
    );
  });
});
