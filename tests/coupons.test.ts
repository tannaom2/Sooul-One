import { describe, expect, it } from "vitest";
import { couponValidity, minimumOrderMessage } from "../src/lib/checkout/coupons";
import { couponInputSchema, couponStatus, endOfDayIST, startOfDayIST } from "../src/lib/validation/coupon";
import { buildQuote } from "../src/lib/checkout/quote";

const now = new Date("2026-09-26T06:00:00Z");
const row = (over: object = {}) => ({
  code: "DIWALI20",
  isActive: true,
  validFrom: new Date("2026-09-01T00:00:00Z"),
  validUntil: new Date("2026-10-31T18:29:59Z"),
  maxUses: null as number | null,
  usedCount: 0,
  ...over,
});

describe("couponValidity", () => {
  it("accepts a live code and explains every refusal", () => {
    expect(couponValidity(row(), now)).toEqual({ ok: true });
    const msg = (r: ReturnType<typeof couponValidity>) => (r.ok ? "" : r.message);
    expect(msg(couponValidity(null, now))).toMatch(/isn't valid/);
    expect(msg(couponValidity(row({ isActive: false }), now))).toMatch(/isn't valid/);
    expect(msg(couponValidity(row({ validFrom: new Date("2026-10-01T00:00:00Z") }), now))).toMatch(/isn't active yet/);
    expect(msg(couponValidity(row({ validUntil: new Date("2026-09-20T00:00:00Z") }), now))).toMatch(/expired/);
    expect(msg(couponValidity(row({ maxUses: 5, usedCount: 5 }), now))).toMatch(/used as many times/);
  });

  it("says how much more to add for a minimum order", () => {
    expect(minimumOrderMessage(99900, 15000, (p) => `₹${p / 100}`)).toBe("This code needs an order of ₹999 or more. Add ₹150 more to use it.");
  });
});

describe("the quote respects a coupon's minimum order", () => {
  const line = (unitPaise: number) => ({
    productId: "p1",
    name: "Masala Chana",
    regulatoryType: "PACKAGED_FOOD" as const,
    unitPricePaise: unitPaise,
    quantity: 1,
    taxRatePercent: 12,
    shelfLifeDays: 180,
    stockQuantity: 10,
  });
  const quote = (unitPaise: number, minOrderPaise: number | null) =>
    buildQuote({
      lines: [line(unitPaise)],
      estimatedDeliveryDate: new Date("2026-10-01"),
      gstTreatment: "INTRA_STATE",
      coupon: { code: "BIG100", type: "FLAT", value: 100, minOrderPaise },
    });

  it("applies the code once the order reaches the minimum", () => {
    const q = quote(100000, 99900);
    expect(q.appliedCouponCode).toBe("BIG100");
    expect(q.discountPaise).toBe(10000);
    expect(q.couponShortfallPaise).toBe(0);
  });

  it("holds it back, and reports the shortfall, below the minimum", () => {
    const q = quote(84900, 99900);
    expect(q.appliedCouponCode).toBeUndefined();
    expect(q.discountPaise).toBe(0);
    expect(q.couponShortfallPaise).toBe(15000);
  });

  it("treats no minimum as no minimum", () => {
    expect(quote(20000, null).appliedCouponCode).toBe("BIG100");
  });
});

describe("couponInputSchema", () => {
  const base = { code: "diwali20", discountType: "PERCENTAGE", discountValue: 20, validFrom: "2026-10-01", validUntil: "2026-10-31" };

  it("normalises the code to capitals", () => {
    const r = couponInputSchema.safeParse(base);
    expect(r.success && r.data.code).toBe("DIWALI20");
  });

  it("refuses typos that would give away too much, and impossible settings", () => {
    const paths = (input: object) => {
      const r = couponInputSchema.safeParse({ ...base, ...input });
      return r.success ? [] : r.error.issues.map((i) => String(i.path[0]));
    };
    expect(paths({ discountValue: 95 })).toContain("discountValue");
    expect(paths({ discountType: "FLAT", discountValue: 500, minOrderValue: 400 })).toContain("discountValue");
    expect(paths({ validUntil: "2026-09-30" })).toContain("validUntil");
    expect(paths({ code: "NO SPACES" })).toContain("code");
    expect(paths({ code: "AB" })).toContain("code");
  });
});

describe("days in India's time zone", () => {
  it("covers the whole calendar day, IST", () => {
    expect(startOfDayIST("2026-10-31").toISOString()).toBe("2026-10-30T18:30:00.000Z");
    expect(endOfDayIST("2026-10-31").toISOString()).toBe("2026-10-31T18:29:59.999Z");
  });
});

describe("couponStatus", () => {
  it("reads off, used up, expired, scheduled or active", () => {
    const c = { isActive: true, validFrom: new Date("2026-09-01"), validUntil: new Date("2026-10-31"), maxUses: null, usedCount: 0 };
    expect(couponStatus(c, now)).toBe("active");
    expect(couponStatus({ ...c, isActive: false }, now)).toBe("off");
    expect(couponStatus({ ...c, maxUses: 3, usedCount: 3 }, now)).toBe("used up");
    expect(couponStatus({ ...c, validUntil: new Date("2026-09-10") }, now)).toBe("expired");
    expect(couponStatus({ ...c, validFrom: new Date("2026-10-05") }, now)).toBe("scheduled");
  });
});
