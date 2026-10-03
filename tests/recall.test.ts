import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IN_STOCK_BATCH_WHERE, SELLABLE_BATCH_WHERE } from "@/lib/basket-rules";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

/**
 * A recalled batch is off sale everywhere (launch defect D1): the reads that
 * feed availability, the basket, checkout and box pools skip it, the order's
 * stock take refuses it, and the database's stock total leaves it out.
 */

const ROOT = join(__dirname, "..");
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// Pages that are meant to list every batch, recalled ones included: the
// owner's Stock batches page and the public batch check (which must say a
// batch is recalled, so it has to find it).
// Pages that list or count every batch received, recalled ones included.
const SHOWS_ALL = new Set(["src/app/admin/(console)/batches/page.tsx", "src/server/batch-verify.ts", "src/app/admin/(console)/suppliers/page.tsx"]);

describe("recalled batches are off sale", () => {
  it("the sellable filters leave recalled batches out", () => {
    expect(SELLABLE_BATCH_WHERE).toEqual({ recalledAt: null });
    expect(IN_STOCK_BATCH_WHERE).toEqual({ quantityRemaining: { gt: 0 }, recalledAt: null });
  });

  it("every batch read in the app uses them, except the pages that list every batch", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      if (SHOWS_ALL.has(rel(file))) continue;
      const source = readFileSync(file, "utf8");
      // A Prisma include or select of a product's batches (not type annotations).
      for (const m of source.matchAll(/\bbatches:\s*(true\b|\{\s*(?:where|orderBy|select|include)\b[^}]*\})/g)) {
        if (!/SELLABLE_BATCH_WHERE|IN_STOCK_BATCH_WHERE/.test(m[0])) offenders.push(`${rel(file)}: ${m[0].replace(/\s+/g, " ").slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the order's stock take refuses a recalled batch, even from a quote made before the recall", async () => {
    const { takeStock } = await import("@/server/order-stock");
    const sql: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        sql.push(strings.join("?"));
        return [];
      }),
    };
    const short = await takeStock(tx as never, [{ id: "b1", qty: 1, name: "Biotin Glow Gummies" }]);
    expect(sql[0]).toContain(`pb."recalledAt" IS NULL`);
    expect(short).toBe("Biotin Glow Gummies"); // nothing taken: the order rolls back
  });

  it("the database's stock total leaves recalled batches out and follows a recall", () => {
    const migration = readFileSync(join(ROOT, "prisma/migrations/20261003090000_recall_off_sale/migration.sql"), "utf8");
    expect(migration.match(/"recalledAt" IS NULL/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toMatch(/UPDATE OF "quantityRemaining", "productId", "recalledAt"/);
  });
});
