import { describe, expect, it } from "vitest";
import {
  buildQuote,
  DEFAULT_SHIPPING_POLICY,
  type QuoteLineInput,
} from "../src/lib/checkout/quote";
import {
  DEFAULT_DELIVERY_CONFIG,
  estimateDeliveryDate,
  zoneForPincode,
} from "../src/lib/checkout/delivery";
import { toPaise } from "../src/lib/money";
import type { BatchLike } from "../src/lib/compliance/shelf-life";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const DELIVERY = d("2026-06-01");

const batch = (id: string, expiresOn: string, qty: number): BatchLike => ({
  id,
  batchNumber: id,
  expiresOn: d(expiresOn),
  quantityRemaining: qty,
});

/** Namkeen: 12% GST, 180-day shelf life, plenty of good stock. */
const namkeen = (over: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  productId: "p_namkeen",
  name: "Roasted Masala Chana",
  regulatoryType: "PACKAGED_FOOD",
  unitPricePaise: toPaise("199"),
  quantity: 2,
  taxRatePercent: 12,
  shelfLifeDays: 180,
  batches: [batch("B1", "2026-12-01", 50)],
  ...over,
});

/** Gummies: 18% GST, 2-year shelf life, subject to the same delivery rule. */
const gummies = (over: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  productId: "p_gummies",
  name: "Biotin Gummies",
  regulatoryType: "HEALTH_SUPPLEMENT",
  unitPricePaise: toPaise("599"),
  quantity: 1,
  taxRatePercent: 18,
  shelfLifeDays: 730,
  batches: [batch("G1", "2027-06-01", 20)],
  ...over,
});

describe("the mixed cart from the definition of done", () => {
  it("prices True Store and gummies items together in one order", () => {
    const quote = buildQuote({
      lines: [namkeen(), gummies()],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.canProceed).toBe(true);
    expect(quote.lines).toHaveLength(2);
    expect(quote.subtotalPaise).toBe(toPaise("997")); // 199*2 + 599
  });

  it("applies each line's own GST rate rather than one blended rate", () => {
    const quote = buildQuote({
      lines: [namkeen(), gummies()],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    const [food, supplement] = quote.lines;
    expect(food.taxRatePercent).toBe(12);
    expect(supplement.taxRatePercent).toBe(18);
    expect(food.taxPaise + supplement.taxPaise).toBeLessThanOrEqual(quote.taxPaise);
  });

  it("ships free above the threshold", () => {
    const quote = buildQuote({
      lines: [gummies({ quantity: 2 })], // ₹1198, above ₹799
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });
    expect(quote.shippingPaise).toBe(0);
  });

  it("charges shipping below the threshold", () => {
    const quote = buildQuote({
      lines: [namkeen({ quantity: 1 })], // ₹199
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });
    expect(quote.shippingPaise).toBe(DEFAULT_SHIPPING_POLICY.flatRatePaise);
    expect(quote.totalPaise).toBe(toPaise("199") + toPaise("59"));
  });
});

describe("the shelf-life rule blocks checkout", () => {
  it("blocks a line whose only stock is too short-dated to ship", () => {
    // 180-day shelf life needs 54 days remaining. Expiry 2026-06-20 leaves 19.
    const quote = buildQuote({
      lines: [namkeen({ batches: [batch("SHORT", "2026-06-20", 100)] })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.canProceed).toBe(false);
    expect(quote.lines[0].status).toBe("BLOCKED");
    expect(quote.lines[0].reason).toBe("NO_COMPLIANT_BATCH");
    expect(quote.subtotalPaise).toBe(0);
  });

  it("tells the shopper why, without exposing batch internals", () => {
    const quote = buildQuote({
      lines: [namkeen({ batches: [batch("SHORT", "2026-06-20", 100)] })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.lines[0].customerMessage).toMatch(/best-before/i);
    expect(quote.lines[0].customerMessage).not.toMatch(/SHORT/);
    // The batch detail is still available for the admin.
    expect(quote.lines[0].rejectedBatches[0].batchNumber).toBe("SHORT");
  });

  it("distinguishes no stock from short-dated stock", () => {
    const empty = buildQuote({
      lines: [namkeen({ batches: [batch("E", "2026-12-01", 0)] })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });
    expect(empty.lines[0].reason).toBe("OUT_OF_STOCK");

    const shortDated = buildQuote({
      lines: [namkeen({ batches: [batch("S", "2026-06-20", 100)] })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });
    expect(shortDated.lines[0].reason).toBe("NO_COMPLIANT_BATCH");
  });

  it("skips short-dated stock and sells the compliant batch instead", () => {
    const quote = buildQuote({
      lines: [
        namkeen({
          batches: [batch("SHORT", "2026-06-20", 100), batch("GOOD", "2026-12-01", 100)],
        }),
      ],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.canProceed).toBe(true);
    expect(quote.lines[0].allocations[0].batchId).toBe("GOOD");
  });

  it("refuses to price food with no shelf-life data rather than assuming one", () => {
    const quote = buildQuote({
      lines: [namkeen({ shelfLifeDays: undefined })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.lines[0].reason).toBe("MISSING_SHELF_LIFE_DATA");
    expect(quote.canProceed).toBe(false);
  });

  it("applies the rule to supplements too, not just packaged food", () => {
    // Health supplements are food products under the FSS Act, so the
    // "any food article" direction reaches them. A 730-day gummy needs 219
    // days remaining; this batch has 92.
    const quote = buildQuote({
      lines: [gummies({ batches: [batch("G", "2026-09-01", 10)] })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.canProceed).toBe(false);
    expect(quote.lines[0].reason).toBe("NO_COMPLIANT_BATCH");
  });

  it("sells a supplement with adequate life left", () => {
    const quote = buildQuote({
      lines: [gummies()],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });
    expect(quote.canProceed).toBe(true);
    expect(quote.lines[0].shelfLifeDataMissing).toBe(false);
  });

  it("falls back to expiry-only for a supplement with no recorded shelf life, and flags it", () => {
    // Blocking the whole gummies catalogue over a data gap would be worse than
    // selling on expiry alone — but the gap must not be invisible.
    const quote = buildQuote({
      lines: [gummies({ shelfLifeDays: undefined, batches: [batch("G", "2026-09-01", 10)] })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.canProceed).toBe(true);
    expect(quote.lines[0].shelfLifeDataMissing).toBe(true);
  });

  it("still refuses expired stock under the fallback", () => {
    const quote = buildQuote({
      lines: [gummies({ shelfLifeDays: undefined, batches: [batch("G", "2026-05-01", 10)] })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.canProceed).toBe(false);
    expect(quote.lines[0].rejectedBatches[0].reason).toBe("EXPIRED");
  });

  it("blocks a retail-only item from being shipped", () => {
    const quote = buildQuote({
      lines: [namkeen({ retailOnly: true })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.lines[0].reason).toBe("RETAIL_ONLY");
    expect(quote.lines[0].customerMessage).toMatch(/stores only/i);
  });
});

describe("partial availability", () => {
  it("flags a short-filled line rather than silently reducing it", () => {
    const quote = buildQuote({
      lines: [namkeen({ quantity: 10, batches: [batch("B1", "2026-12-01", 4)] })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.lines[0].status).toBe("PARTIAL");
    expect(quote.lines[0].quantityAvailable).toBe(4);
    expect(quote.canProceed).toBe(false);
    expect(quote.lines[0].customerMessage).toMatch(/Only 4 available/);
  });

  it("prices only the available quantity", () => {
    const quote = buildQuote({
      lines: [namkeen({ quantity: 10, batches: [batch("B1", "2026-12-01", 4)] })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });
    expect(quote.lines[0].grossPaise).toBe(toPaise("796")); // 199 * 4
  });
});

describe("coupons and tax interaction", () => {
  it("computes GST on the discounted amount, not the pre-discount amount", () => {
    // Shipping is forced free so the comparison isolates goods tax.
    const alwaysFreeShipping = { ...DEFAULT_SHIPPING_POLICY, freeAbovePaise: 0 };

    const withoutCoupon = buildQuote({
      lines: [gummies({ quantity: 2 })], // ₹1198 at 18%
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      shipping: alwaysFreeShipping,
    });

    const withCoupon = buildQuote({
      lines: [gummies({ quantity: 2 })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      coupon: { code: "SAVE50", type: "PERCENTAGE", value: 50 },
      shipping: alwaysFreeShipping,
    });

    // Half the money means half the tax. Computing tax pre-discount would
    // leave these equal, which over-declares output tax on every promotion.
    expect(withCoupon.taxPaise).toBeLessThan(withoutCoupon.taxPaise);
    expect(withCoupon.taxPaise * 2).toBeCloseTo(withoutCoupon.taxPaise, -1);
  });

  it("tests free shipping against the DISCOUNTED total, not the original", () => {
    // A ₹1198 order ships free; a 50% coupon takes it to ₹599 and shipping
    // becomes payable again. This is the common merchant convention — the
    // alternative lets a coupon buy free shipping it didn't qualify for — but
    // it surprises customers, so it is worth confirming as a business choice
    // rather than inheriting it silently.
    const quote = buildQuote({
      lines: [gummies({ quantity: 2 })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      coupon: { code: "SAVE50", type: "PERCENTAGE", value: 50 },
    });

    expect(quote.shippingPaise).toBe(DEFAULT_SHIPPING_POLICY.flatRatePaise);
  });

  it("splits a discount across lines so the parts sum to the whole exactly", () => {
    const quote = buildQuote({
      lines: [namkeen({ quantity: 3 }), gummies({ quantity: 2 })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      coupon: { code: "ODD", type: "FLAT", value: 101 },
    });

    const sum = quote.lines.reduce((total, l) => total + l.discountPaise, 0);
    expect(sum).toBe(quote.discountPaise);
    expect(quote.discountPaise).toBe(toPaise("101"));
  });

  it("splits proportionally to line value", () => {
    const quote = buildQuote({
      lines: [
        namkeen({ quantity: 1, unitPricePaise: toPaise("100") }),
        gummies({ quantity: 1, unitPricePaise: toPaise("300") }),
      ],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      coupon: { code: "FLAT40", type: "FLAT", value: 40 },
    });

    expect(quote.lines[0].discountPaise).toBe(toPaise("10")); // 25% of value
    expect(quote.lines[1].discountPaise).toBe(toPaise("30")); // 75% of value
  });

  it("does not discount a blocked line", () => {
    const quote = buildQuote({
      lines: [
        namkeen({ batches: [batch("SHORT", "2026-06-20", 100)] }),
        gummies({ quantity: 2 }),
      ],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      coupon: { code: "SAVE10", type: "PERCENTAGE", value: 10 },
    });

    expect(quote.lines[0].discountPaise).toBe(0);
    expect(quote.lines[1].discountPaise).toBe(quote.discountPaise);
  });

  it("only reports a coupon code when it actually reduced the total", () => {
    const quote = buildQuote({
      lines: [namkeen({ batches: [batch("SHORT", "2026-06-20", 100)] })],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      coupon: { code: "SAVE10", type: "PERCENTAGE", value: 10 },
    });
    expect(quote.appliedCouponCode).toBeUndefined();
  });

  it("never lets an oversized coupon produce a negative total", () => {
    const quote = buildQuote({
      lines: [namkeen({ quantity: 1 })], // ₹199
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      coupon: { code: "HUGE", type: "FLAT", value: 5000 },
    });

    expect(quote.totalPaise).toBeGreaterThanOrEqual(0);
    expect(quote.discountPaise).toBe(toPaise("199"));
  });
});

describe("GST treatment by destination", () => {
  it("splits into CGST and SGST within the state", () => {
    const quote = buildQuote({
      lines: [gummies()],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.igstPaise).toBe(0);
    expect(quote.cgstPaise + quote.sgstPaise).toBe(quote.taxPaise);
  });

  it("routes to IGST across state lines", () => {
    const quote = buildQuote({
      lines: [gummies()],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTER_STATE",
    });

    expect(quote.igstPaise).toBe(quote.taxPaise);
    expect(quote.cgstPaise).toBe(0);
  });

  it("charges the same total either way — only the split differs", () => {
    const intra = buildQuote({
      lines: [namkeen(), gummies()],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });
    const inter = buildQuote({
      lines: [namkeen(), gummies()],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTER_STATE",
    });

    expect(intra.totalPaise).toBe(inter.totalPaise);
    expect(intra.taxPaise).toBe(inter.taxPaise);
  });
});

describe("quote arithmetic reconciles", () => {
  it("total equals subtotal minus discount plus shipping", () => {
    const quote = buildQuote({
      lines: [namkeen({ quantity: 3 }), gummies()],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      coupon: { code: "SAVE15", type: "PERCENTAGE", value: 15 },
    });

    expect(quote.totalPaise).toBe(
      quote.subtotalPaise - quote.discountPaise + quote.shippingPaise,
    );
  });

  it("tax is contained within the total, not added on top", () => {
    const quote = buildQuote({
      lines: [namkeen(), gummies()],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });
    expect(quote.taxPaise).toBeLessThan(quote.totalPaise);
  });

  it("handles an empty cart without throwing", () => {
    const quote = buildQuote({
      lines: [],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
    });

    expect(quote.totalPaise).toBe(0);
    expect(quote.canProceed).toBe(false);
  });
});

describe("delivery estimation", () => {
  it("is pessimistic by design — uses the slowest transit, not the midpoint", () => {
    const placed = d("2026-06-01"); // Monday
    const metro = estimateDeliveryDate(placed, "METRO");
    const expected = DEFAULT_DELIVERY_CONFIG.dispatchLeadDays + 4;
    expect(metro).toEqual(d("2026-06-07"));
    expect(expected).toBe(6);
  });

  it("takes longer for remote destinations", () => {
    const placed = d("2026-06-01");
    expect(estimateDeliveryDate(placed, "REST_OF_INDIA").getTime()).toBeGreaterThan(
      estimateDeliveryDate(placed, "METRO").getTime(),
    );
  });

  it("adds a buffer for weekend orders", () => {
    const saturday = d("2026-06-06");
    const monday = d("2026-06-08");
    const satSpan = estimateDeliveryDate(saturday, "METRO").getTime() - saturday.getTime();
    const monSpan = estimateDeliveryDate(monday, "METRO").getTime() - monday.getTime();
    expect(satSpan).toBeGreaterThan(monSpan);
  });

  it("normalises to midnight so it compares cleanly with expiry dates", () => {
    const evening = new Date("2026-06-01T22:47:13.000Z");
    const result = estimateDeliveryDate(evening, "METRO");
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
  });

  it("maps known pincodes and defaults unknown ones to the slowest zone", () => {
    expect(zoneForPincode("400601")).toBe("METRO");
    expect(zoneForPincode("302001")).toBe("TIER_2");
    expect(zoneForPincode("999999")).toBe("REST_OF_INDIA");
  });

  it("a slower zone can block stock a faster zone would accept", () => {
    // Expiry 2026-07-31; 180-day product needs 54 days at delivery.
    // Metro arrives 06-07 (54 days left, just passes); remote 06-12 (49, fails).
    const stock = [batch("EDGE", "2026-07-31", 50)];
    const placed = d("2026-06-01");

    const metro = buildQuote({
      lines: [namkeen({ batches: stock })],
      estimatedDeliveryDate: estimateDeliveryDate(placed, "METRO"),
      gstTreatment: "INTRA_STATE",
    });
    const remote = buildQuote({
      lines: [namkeen({ batches: stock })],
      estimatedDeliveryDate: estimateDeliveryDate(placed, "REST_OF_INDIA"),
      gstTreatment: "INTRA_STATE",
    });

    expect(metro.canProceed).toBe(true);
    expect(remote.canProceed).toBe(false);
  });
});
