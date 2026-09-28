import { describe, expect, it } from "vitest";
import { buildQuote, DEFAULT_SHIPPING_POLICY, type QuoteBox, type QuoteInput, type QuoteLineInput } from "../src/lib/checkout/quote";
import type { BundleRule } from "../src/lib/checkout/bundles";

/**
 * Property test for the pricing engine: thousands of random baskets (kits,
 * boxes, sale prices, codes, referral credit, short-dated and missing stock,
 * both GST treatments) must always produce money that adds up, in whole paise,
 * never negative, never NaN. A seeded generator, so any failure reproduces.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

const DELIVERY = new Date("2026-10-05T00:00:00Z");
const day = (n: number) => new Date(DELIVERY.getTime() + n * 86_400_000);

function randomInput(seed: number): QuoteInput {
  const r = rng(seed);
  const count = r.int(1, 6);
  const lines: QuoteLineInput[] = [];
  const boxLines: number[] = [];
  for (let i = 0; i < count; i++) {
    const list = r.int(49, 1999) * 100 + r.pick([0, 0, 0, 50, 99]);
    const onSale = r.chance(0.3);
    const unit = onSale ? Math.round(list * (1 - r.int(5, 40) / 100)) : list;
    const stock = r.pick(["plenty", "short", "none", "shortDated", "untracked"]);
    const quantity = r.int(1, 5);
    const inBox = r.chance(0.25);
    if (inBox) boxLines.push(i);
    lines.push({
      productId: `p${i}`,
      name: `P${i}`,
      regulatoryType: r.pick(["PACKAGED_FOOD", "HEALTH_SUPPLEMENT"] as const),
      unitPricePaise: unit,
      listPricePaise: list,
      quantity,
      taxRatePercent: r.pick([5, 12, 18]),
      shelfLifeDays: r.pick([90, 180, 365, 730]),
      batches:
        stock === "untracked"
          ? undefined
          : stock === "none"
            ? []
            : [{ id: `b${i}`, batchNumber: `B${i}`, expiresOn: stock === "shortDated" ? day(10) : day(700), quantityRemaining: stock === "short" ? Math.max(0, quantity - 1) : 50 }],
      stockQuantity: stock === "untracked" ? r.int(0, 10) : undefined,
      boxId: inBox ? "box1" : undefined,
    });
  }
  const bundles: BundleRule[] = r.chance(0.6)
    ? [
        {
          id: "k1",
          name: "Kit",
          minItems: r.int(2, 3),
          maxItems: r.chance(0.5) ? 3 : null,
          discountType: r.pick(["PERCENTAGE", "FLAT"] as const),
          discountValue: r.int(5, 30),
          stepUpValue: r.chance(0.3) ? 35 : null,
          eligibleProductIds: lines.filter(() => r.chance(0.6)).map((l) => l.productId),
        },
      ]
    : [];
  const boxes: QuoteBox[] = boxLines.length ? [{ id: "box1", boxId: "B", name: "Box", pricePaise: r.int(5, 20) * 10000 - 100, complete: r.chance(0.7) }] : [];
  return {
    lines,
    estimatedDeliveryDate: DELIVERY,
    gstTreatment: r.pick(["INTRA_STATE", "INTER_STATE"] as const),
    bundles,
    boxes,
    coupon: r.chance(0.4) ? { code: "C", type: r.pick(["PERCENTAGE", "FLAT"] as const), value: r.int(5, 300), minOrderPaise: r.chance(0.5) ? r.int(0, 1500) * 100 : null } : undefined,
    credit: r.chance(0.4) ? { kind: r.pick(["WALLET", "WELCOME"] as const), amountPaise: r.int(1, 3) * 5000, minOrderPaise: 79900 } : undefined,
  };
}

const RUNS = 3000;

describe("pricing engine invariants over random baskets", () => {
  it(`holds for ${RUNS} random baskets`, () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const input = randomInput(seed);
      const q = buildQuote(input);
      const ctx = `seed ${seed}`;
      const money = [q.listSubtotalPaise, q.subtotalPaise, q.bundleDiscountPaise, q.discountPaise, q.creditPaise, q.shippingPaise, q.taxPaise, q.totalPaise];
      for (const m of money) {
        expect(Number.isInteger(m), `${ctx}: whole paise`).toBe(true);
        expect(m, `${ctx}: never negative`).toBeGreaterThanOrEqual(0);
      }
      // The total is exactly what's left after every saving, plus delivery.
      expect(q.totalPaise, ctx).toBe(q.subtotalPaise - q.bundleDiscountPaise - q.discountPaise - q.creditPaise + q.shippingPaise);
      // Line by line, taxable value and tax add back up to the goods total.
      const goods = q.lines.reduce((n, l) => n + l.taxablePaise + l.taxPaise, 0);
      expect(goods + q.shippingPaise, `${ctx}: lines + delivery = total`).toBe(q.totalPaise);
      expect(q.cgstPaise + q.sgstPaise + q.igstPaise, ctx).toBe(q.taxPaise);
      if (input.gstTreatment === "INTRA_STATE") expect(q.igstPaise, ctx).toBe(0);
      else expect(q.cgstPaise + q.sgstPaise, ctx).toBe(0);
      for (const l of q.lines) {
        expect(l.bundleDiscountPaise + l.discountPaise + l.creditPaise, `${ctx}: savings never exceed a line`).toBeLessThanOrEqual(l.grossPaise);
        if (l.status === "BLOCKED") expect(l.grossPaise, `${ctx}: nothing charged for what can't ship`).toBe(0);
        expect(l.quantityAvailable, ctx).toBeLessThanOrEqual(l.quantityRequested);
      }
      // Delivery: free exactly at the threshold, judged before referral credit.
      const beforeCredit = q.subtotalPaise - q.bundleDiscountPaise - q.discountPaise;
      expect(q.shippingPaise, ctx).toBe(beforeCredit === 0 || beforeCredit >= DEFAULT_SHIPPING_POLICY.freeAbovePaise ? 0 : DEFAULT_SHIPPING_POLICY.flatRatePaise);
      // Offers never stack: credit and an applied code are never both taken.
      expect(q.creditPaise > 0 && q.discountPaise > 0, ctx).toBe(false);
      // Checkout only proceeds when every line can ship in full.
      expect(q.canProceed, ctx).toBe(q.lines.every((l) => l.status === "OK"));
      // An incomplete box gets no box price.
      if (input.boxes?.[0] && !input.boxes[0].complete) expect(q.appliedBoxes, ctx).toHaveLength(0);
      // Same basket, same answer.
      expect(buildQuote(input), `${ctx}: deterministic`).toEqual(q);
    }
  }, 60_000);
});
