import { describe, expect, it } from "vitest";
import { trustFacts, type TrustInput } from "@/lib/trust-strip";
import { railOrder } from "@/lib/home-rail";
import { showsTabBar } from "@/lib/tab-bar";

/** Sprint 3, the home page on every screen: trust strip, Bestsellers rail, tab bar. */

const ALL_ON: TrustInput = { fssaiLicence: "10726001000417", codEnabled: true, freeDeliveryAbove: 799 };
const ids = (topBar: string[], input: TrustInput = ALL_ON) => trustFacts(input, topBar).map((f) => f.id);

describe("the trust strip", () => {
  it("shows only facts the store's settings back", () => {
    expect(ids([])).toEqual(["fssai", "cod", "free-delivery", "shelf-life", "batch"]);
    expect(ids([], { fssaiLicence: null, codEnabled: false, freeDeliveryAbove: null })).toEqual(["shelf-life", "batch"]);
    expect(trustFacts(ALL_ON, []).find((f) => f.id === "free-delivery")?.text).toBe("Free delivery over ₹799");
    expect(trustFacts(ALL_ON, []).find((f) => f.id === "batch")?.href).toBe("/verify");
  });

  it("never repeats what the top bar already says", () => {
    expect(ids(["We only deliver in Gujarat", "Free delivery above ₹799", "Orders dispatched within 24 hours"])).toEqual(["fssai", "cod", "shelf-life", "batch"]);
    expect(ids(["COD available on every order", "Free shipping over ₹999"])).toEqual(["fssai", "shelf-life", "batch"]);
    expect(ids(["FSSAI licensed kitchens", "Verify your pack's batch online"])).toEqual(["cod", "free-delivery", "shelf-life"]);
  });
});

describe("the Bestsellers rail", () => {
  it("puts Featured first, then the month's best sellers by units, then fills from the catalogue, each once", () => {
    const order = railOrder({ featured: ["f1"], unitsSold: new Map([["b2", 3], ["b1", 9], ["f1", 50], ["zero", 0]]), others: ["o1", "b1", "o2"] }, 5);
    expect(order).toEqual(["f1", "b1", "b2", "o1", "o2"]);
  });

  it("is never empty in a new store with no orders", () => {
    expect(railOrder({ featured: [], unitsSold: new Map(), others: ["a", "b"] })).toEqual(["a", "b"]);
  });
});

describe("the bottom tab bar", () => {
  it("shows on shop pages", () => {
    for (const path of ["/", "/gummies", "/gummies/kids-vault", "/true-store", "/search", "/learn", "/account", "/stores"]) expect(showsTabBar(path)).toBe(true);
  });

  it("stays off pages with their own bottom bar, checkout and the console", () => {
    for (const path of ["/product/biotin-glow", "/box/gummies-box", "/cart", "/checkout", "/admin", "/admin/orders", "/order/SO-1"]) expect(showsTabBar(path)).toBe(false);
    expect(showsTabBar("/boxes-of-joy")).toBe(true); // a prefix of a word isn't a match
  });
});
