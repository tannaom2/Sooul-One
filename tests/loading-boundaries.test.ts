import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A loading.tsx makes everything under it stream, so the response is already
 * "200" before a page can call notFound(). Keep skeletons off any folder with
 * a slug page beneath it, or a removed product (brand, box, policy, article)
 * answers 200 instead of 404 (see src/components/skeletons.tsx).
 */
const APP = join(__dirname, "../src/app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? [path, ...walk(path)] : [];
  });
}

describe("loading screens", () => {
  it("sit only on folders with no [slug] page beneath them", () => {
    const offenders = walk(APP)
      .filter((dir) => readdirSync(dir).includes("loading.tsx"))
      .filter((dir) => walk(dir).some((sub) => /\[[^\]]+\]/.test(relative(dir, sub))) || /\[[^\]]+\]/.test(relative(APP, dir)))
      .map((dir) => relative(APP, dir).split("\\").join("/"));
    expect(offenders).toEqual([]);
  });

  it("cover the slow listing and search pages", () => {
    for (const page of ["true-store", "search", "cart"]) expect(readdirSync(join(APP, page))).toContain("loading.tsx");
  });
});
