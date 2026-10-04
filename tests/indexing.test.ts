import { describe, expect, it } from "vitest";
import { mayIndex, searchIndexingOn } from "@/lib/indexing";

/** Search engines kept out until launch, and off every address but the shop's own. */

describe("the search indexing switch", () => {
  it("is off unless it says on", () => {
    expect(searchIndexingOn(undefined)).toBe(false);
    expect(searchIndexingOn("")).toBe(false);
    expect(searchIndexingOn("yes")).toBe(false);
    expect(searchIndexingOn("on")).toBe(true);
    expect(searchIndexingOn(" ON ")).toBe(true);
  });

  it("lets search engines in only when on, and only on the shop's own domains", () => {
    const main = "sooulone.in";
    expect(mayIndex({ on: false, host: "sooulone.in", mainHost: main, standaloneBrand: false })).toBe(false);
    expect(mayIndex({ on: true, host: "sooulone.in", mainHost: main, standaloneBrand: false })).toBe(true);
    expect(mayIndex({ on: true, host: "www.sooulone.in", mainHost: main, standaloneBrand: false })).toBe(true);
    expect(mayIndex({ on: true, host: "womanaxis.in", mainHost: main, standaloneBrand: true })).toBe(true);
    // The hosting company's address serves the same pages: never indexed.
    expect(mayIndex({ on: true, host: "sooulone.onrender.com", mainHost: main, standaloneBrand: false })).toBe(false);
    expect(mayIndex({ on: true, host: null, mainHost: main, standaloneBrand: false })).toBe(false);
  });
});
