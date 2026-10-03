import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Benchmark gap F4: an order only moves stock, so it marks the catalog stale
 * (the next visitor still gets the cached page at once) instead of expiring
 * it (every product page's next view waited seconds on a cold cache). What a
 * shopper must see at once, a price or a recall, still expires it.
 */

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag }));

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("catalog cache", () => {
  it("refreshes in the background for stock, and expires at once otherwise", async () => {
    const { refreshTag, expireTag } = await import("@/lib/cache-tags");
    refreshTag("catalog");
    expireTag("catalog");
    expect(revalidateTag.mock.calls).toEqual([
      ["catalog", "max"],
      ["catalog", { expire: 0 }],
    ]);
  });

  it("is only marked stale where stock moved: orders, the unpaid sweep, late payments, cancellations", () => {
    for (const file of ["src/app/api/checkout/create-order/route.ts", "src/app/api/cron/expire-unpaid/route.ts", "src/server/payments.ts"]) {
      expect(read(file)).toContain("refreshTag(CATALOG_TAG)");
      expect(read(file)).not.toContain("expireTag(CATALOG_TAG)");
    }
  });

  it("still expires at once for a recall or a product edit", () => {
    expect(read("src/app/admin/(console)/batches/actions.ts")).toContain("expireTag(CATALOG_TAG)");
    expect(read("src/app/admin/(console)/batches/actions.ts")).not.toContain("refreshTag");
    expect(read("src/app/admin/(console)/actions.ts")).toContain("expireTag(CATALOG_TAG)");
  });
});
