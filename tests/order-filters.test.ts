import { describe, expect, it } from "vitest";
import { orderFiltersHref, parseOrderFilters, percentChange } from "../src/lib/order-filters";

describe("parseOrderFilters", () => {
  it("defaults when nothing is given", () => {
    expect(parseOrderFilters({})).toEqual({ view: "all", q: "", page: 1 });
  });

  it("accepts known views", () => {
    expect(parseOrderFilters({ view: "to_ship" }).view).toBe("to_ship");
  });

  it("ignores unknown or prototype views", () => {
    expect(parseOrderFilters({ view: "PAID' OR 1=1" }).view).toBe("all");
    expect(parseOrderFilters({ view: "__proto__" }).view).toBe("all");
    expect(parseOrderFilters({ view: "toString" }).view).toBe("all");
  });

  it("clamps the page number", () => {
    expect(parseOrderFilters({ page: "-5" }).page).toBe(1);
    expect(parseOrderFilters({ page: "abc" }).page).toBe(1);
    expect(parseOrderFilters({ page: "2.9" }).page).toBe(2);
    expect(parseOrderFilters({ page: "99999999" }).page).toBe(10_000);
  });

  it("trims and caps the search text", () => {
    expect(parseOrderFilters({ q: "  so-123  " }).q).toBe("so-123");
    expect(parseOrderFilters({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
});

describe("orderFiltersHref", () => {
  it("drops defaults", () => {
    expect(orderFiltersHref({ view: "all", q: "", page: 1 })).toBe("/admin/orders");
  });

  it("encodes the search text", () => {
    expect(orderFiltersHref({ view: "shipped", q: "a&b", page: 2 })).toBe("/admin/orders?view=shipped&q=a%26b&page=2");
  });
});

describe("percentChange", () => {
  it("is null with nothing to compare against", () => {
    expect(percentChange(5, 0)).toBeNull();
  });

  it("rounds up and down moves", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(100, 100)).toBe(0);
  });
});
