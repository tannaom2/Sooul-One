import { describe, expect, it } from "vitest";
import { INTEL_PAGE_SIZE, pageCount, pageOf, parsePage } from "@/lib/intel/paging";
import { BAND_ACTION, looksGibberish, riskBand, scoreRtoRisk, smoothedRate, type RiskInput } from "@/lib/intel/rto-risk";
import {
  BUYER_RTO_LIMIT,
  autoBlocks,
  codDecision,
  codRefusalMessage,
  demandByPincode,
  pincodeStats,
  postalRegion,
  storeCodRtoRate,
  type CodSettings,
  type PincodeOrder,
} from "@/lib/intel/pincodes";
import { customerCaused, judge, overallStatus, paymentHealth, tripwire, wilson, type AttemptLike } from "@/lib/intel/payment-health";
import {
  buildProfiles,
  cohorts,
  customerKey,
  frequencyScore,
  recencyScore,
  scoreRfm,
  segmentOf,
  unitEconomics,
  type CustomerOrder,
} from "@/lib/intel/customers";

/**
 * The intelligence engine's rules (docs/INTELLIGENCE.md): every number on
 * the Pincodes, Payments, Customers and RTO risk pages comes from these.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-29T06:30:00Z"); // noon in India

describe("the 10-item rule", () => {
  it("shows ten per page and clamps the page to what exists", () => {
    expect(INTEL_PAGE_SIZE).toBe(10);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(30)).toBe(3);
    expect(pageCount(31)).toBe(4);
    expect(parsePage("2", 30)).toBe(2);
    expect(parsePage("9", 30)).toBe(3);
    expect(parsePage("-1", 30)).toBe(1);
    expect(parsePage("abc", 30)).toBe(1);
    expect(parsePage(undefined, 30)).toBe(1);
    const rows = Array.from({ length: 25 }, (_, i) => i);
    expect(pageOf(rows, 3)).toEqual([20, 21, 22, 23, 24]);
  });
});

/* ---------------------------------------------------------------- risk */

const base: RiskInput = {
  cod: true,
  totalPaise: 699_00,
  units: 2,
  maxUnitsOfOneProduct: 1,
  placedAt: NOW,
  phoneVerified: true,
  priorDelivered: 0,
  priorReturnedToOrigin: 0,
  priorPrepaidDelivered: 0,
  recentOpenCod: 0,
  pincode: null,
  storeCodRtoRate: 0.1,
  address: "B-104, Shanti Residency, Vastrapur",
};

const codes = (input: Partial<RiskInput>) => scoreRtoRisk({ ...base, ...input }).reasons.map((r) => r.code);

describe("RTO risk score", () => {
  it("a first cash on delivery order with a confirmed number and a good address is medium", () => {
    const r = scoreRtoRisk(base);
    expect(r.reasons.map((x) => x.code)).toEqual(["COD", "FIRST_ORDER"]);
    expect(r.score).toBe(40);
    expect(r.band).toBe("MEDIUM");
  });

  it("a prepaid order from a returning buyer is low, and never negative", () => {
    const r = scoreRtoRisk({ ...base, cod: false, priorDelivered: 4 });
    expect(r.score).toBe(0);
    expect(r.band).toBe("LOW");
  });

  it("adds up the published signals and caps at 100", () => {
    const r = scoreRtoRisk({
      ...base,
      phoneVerified: false,
      priorReturnedToOrigin: 2,
      totalPaise: 3500_00,
      units: 8,
      placedAt: new Date("2026-09-28T18:40:00Z"), // 00:10 in India
      address: "asdfgh",
      recentOpenCod: 1,
      pincode: { codFinished: 20, codReturned: 10 },
    });
    expect(r.score).toBe(100);
    expect(r.band).toBe("VERY_HIGH");
    expect(r.reasons.map((x) => x.code)).toEqual(
      expect.arrayContaining(["PHONE_UNVERIFIED", "PAST_RTO", "COD_VALUE_HIGH", "BULK", "LATE_NIGHT", "THIN_ADDRESS", "GIBBERISH_ADDRESS", "DUPLICATE_COD", "PINCODE_HIGH"]),
    );
  });

  it("an earlier refusal counts 30, two or more cap at 40", () => {
    const one = scoreRtoRisk({ ...base, priorReturnedToOrigin: 1 }).reasons.find((r) => r.code === "PAST_RTO");
    const three = scoreRtoRisk({ ...base, priorReturnedToOrigin: 3 }).reasons.find((r) => r.code === "PAST_RTO");
    expect(one?.points).toBe(30);
    expect(three?.points).toBe(40);
    // Someone who has refused before is not a "first order".
    expect(codes({ priorReturnedToOrigin: 1 })).not.toContain("FIRST_ORDER");
  });

  it("earns credit for past deliveries and past prepayment", () => {
    expect(codes({ priorDelivered: 1 })).toContain("DELIVERED_BEFORE");
    expect(codes({ priorDelivered: 3 })).toContain("LOYAL");
    expect(codes({ priorDelivered: 1, priorPrepaidDelivered: 1 })).toContain("PREPAID_HISTORY");
    expect(scoreRtoRisk({ ...base, priorDelivered: 3, priorPrepaidDelivered: 1 }).score).toBe(0);
  });

  it("judges the pincode against the store's rate, smoothed so one refusal isn't 100%", () => {
    expect(smoothedRate(1, 1, 0.1)).toBeCloseTo(0.25);
    // One refusal out of one parcel: raised, never "high".
    expect(codes({ pincode: { codFinished: 1, codReturned: 1 } })).toContain("PINCODE_RAISED");
    expect(codes({ pincode: { codFinished: 20, codReturned: 8 } })).toContain("PINCODE_HIGH");
    expect(codes({ pincode: { codFinished: 20, codReturned: 0 } })).toContain("PINCODE_GOOD");
    expect(codes({ pincode: { codFinished: 3, codReturned: 0 } })).not.toContain("PINCODE_GOOD");
    // No store history yet: the pincode can't be judged.
    expect(codes({ pincode: { codFinished: 5, codReturned: 5 }, storeCodRtoRate: 0 })).not.toContain("PINCODE_HIGH");
  });

  it("raises the value steps only for cash on delivery", () => {
    expect(codes({ totalPaise: 1600_00 })).toContain("COD_VALUE_RAISED");
    expect(codes({ totalPaise: 1600_00, cod: false })).not.toContain("COD_VALUE_RAISED");
  });

  it("counts late night in India time, 11 pm to 5 am", () => {
    expect(codes({ placedAt: new Date("2026-09-28T17:35:00Z") })).toContain("LATE_NIGHT"); // 23:05 IST
    expect(codes({ placedAt: new Date("2026-09-28T23:25:00Z") })).toContain("LATE_NIGHT"); // 04:55 IST
    expect(codes({ placedAt: new Date("2026-09-28T23:35:00Z") })).not.toContain("LATE_NIGHT"); // 05:05 IST
  });

  it("spots made-up addresses but not Indian address shorthand", () => {
    expect(looksGibberish("aaaaaa street")).toBe(true);
    expect(looksGibberish("qwerty 12")).toBe(true);
    expect(looksGibberish("xyzkqp bcdfgh, 44")).toBe(true);
    expect(looksGibberish("A-104, GIDC Estate, Vatva")).toBe(false);
    expect(looksGibberish("B/2 Shyam Flats, Nr. SBI, Paldi")).toBe(false);
    expect(looksGibberish("12, Sector 21")).toBe(false);
  });

  it("maps scores to bands with an action for each", () => {
    expect([riskBand(0), riskBand(29), riskBand(30), riskBand(59), riskBand(60), riskBand(79), riskBand(80)]).toEqual(["LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "VERY_HIGH"]);
    expect(Object.keys(BAND_ACTION)).toEqual(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]);
  });
});

/* ------------------------------------------------------------ pincodes */

const order = (o: Partial<PincodeOrder>): PincodeOrder => ({
  pincode: "380015",
  city: "Ahmedabad",
  status: "DELIVERED",
  cod: true,
  totalPaise: 500_00,
  placedAt: new Date("2026-09-20T06:00:00Z"),
  deliveredAt: new Date("2026-09-22T10:00:00Z"),
  promisedDeliveryDate: new Date("2026-09-22T00:00:00Z"),
  ...o,
});

describe("pincode stats", () => {
  it("counts outcomes, COD returns, delivery speed and on-time delivery per pincode", () => {
    const [s] = pincodeStats([
      order({}),
      order({ status: "RTO", deliveredAt: null }),
      order({ cod: false, deliveredAt: new Date("2026-09-24T10:00:00Z") }),
      order({ status: "CANCELLED", deliveredAt: null }),
      order({ status: "PROCESSING", deliveredAt: null }),
    ]);
    expect(s).toMatchObject({ pincode: "380015", orders: 5, codOrders: 4, delivered: 2, rto: 1, cancelled: 1, codFinished: 2, codReturned: 1 });
    expect(s.successRate).toBeCloseTo(2 / 3);
    expect(s.codRtoRate).toBe(0.5);
    // 2.17 days and 4.17 days from order to door.
    expect(s.avgDeliveryDays).toBeCloseTo(3.17, 1);
    // Delivered 22 Sept at 3:30 pm IST counts as on time for a 22 Sept promise; 24 Sept doesn't.
    expect(s.onTimeRate).toBe(0.5);
    // Kept revenue: delivered and in flight, not cancelled or returned.
    expect(s.revenuePaise).toBe(1500_00);
  });

  it("ignores malformed pincodes and gives nulls before there's anything to measure", () => {
    const stats = pincodeStats([order({ pincode: "12" }), order({ pincode: "390001", status: "PAID", deliveredAt: null })]);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ successRate: null, codRtoRate: null, avgDeliveryDays: null, onTimeRate: null });
  });

  it("works out the store-wide COD return rate from every pincode", () => {
    const stats = pincodeStats([order({}), order({ status: "RTO" }), order({ pincode: "390001" }), order({ pincode: "390001" })]);
    expect(storeCodRtoRate(stats)).toBe(0.25);
    expect(storeCodRtoRate([])).toBe(0);
  });
});

const settings: CodSettings = { codAutoBlock: true, codAutoBlockRtoPercent: 35, codAutoBlockMinShipped: 4, codMinOrderValue: null, codMaxOrderValue: null };

describe("cash on delivery rules at checkout", () => {
  it("switches COD off automatically only when opted in, with enough parcels, at the threshold", () => {
    expect(autoBlocks({ codFinished: 4, codReturned: 2 }, settings)).toBe(true);
    expect(autoBlocks({ codFinished: 3, codReturned: 3 }, settings)).toBe(false); // too few parcels
    expect(autoBlocks({ codFinished: 10, codReturned: 3 }, settings)).toBe(false); // 30% < 35%
    expect(autoBlocks({ codFinished: 20, codReturned: 7 }, settings)).toBe(true); // exactly 35%
    expect(autoBlocks({ codFinished: 4, codReturned: 4 }, { ...settings, codAutoBlock: false })).toBe(false);
    expect(autoBlocks(null, settings)).toBe(false);
  });

  it("lets the owner's pincode rule win over the automatic one, both ways", () => {
    const record = { codFinished: 10, codReturned: 9 };
    expect(codDecision({ rule: null, record, settings, totalPaise: 500_00 })).toEqual({ allowed: false, reason: "AUTO_BLOCKED" });
    expect(codDecision({ rule: { codBlocked: false, codAllowed: true, extraDays: 0 }, record, settings, totalPaise: 500_00 })).toEqual({ allowed: true });
    expect(codDecision({ rule: { codBlocked: true, codAllowed: false, extraDays: 0 }, record: null, settings, totalPaise: 500_00 })).toEqual({ allowed: false, reason: "PINCODE_BLOCKED" });
  });

  it("applies the order-value floor and cap, and a buyer's repeated refusals", () => {
    const limits = { ...settings, codMinOrderValue: 299, codMaxOrderValue: 3000 };
    expect(codDecision({ rule: null, record: null, settings: limits, totalPaise: 129_00 })).toEqual({ allowed: false, reason: "UNDER_MIN" });
    expect(codDecision({ rule: null, record: null, settings: limits, totalPaise: 299_00 })).toEqual({ allowed: true });
    expect(codDecision({ rule: null, record: null, settings: limits, totalPaise: 3000_01 })).toEqual({ allowed: false, reason: "OVER_CAP" });
    expect(codDecision({ rule: null, record: null, settings, totalPaise: 500_00, buyerReturned: BUYER_RTO_LIMIT })).toEqual({ allowed: false, reason: "BUYER_RTO" });
    expect(codDecision({ rule: null, record: null, settings, totalPaise: 500_00, buyerReturned: 1 })).toEqual({ allowed: true });
    // No total yet (quote still loading): the value rules wait.
    expect(codDecision({ rule: null, record: null, settings: limits, totalPaise: null })).toEqual({ allowed: true });
  });

  it("tells the shopper how to pay instead, never blaming them", () => {
    const limits = { codMinOrderValue: 299, codMaxOrderValue: 3000 };
    expect(codRefusalMessage("UNDER_MIN", limits)).toContain("₹299 or more");
    expect(codRefusalMessage("OVER_CAP", limits)).toContain("up to ₹3,000");
    expect(codRefusalMessage("PINCODE_BLOCKED", limits)).toMatch(/Pay online/);
    expect(codRefusalMessage("BUYER_RTO", limits)).toMatch(/Pay online/);
  });
});

describe("pincode demand", () => {
  it("counts checks per pincode, busiest first, and names the region", () => {
    const d = demandByPincode([
      { pincode: "400001", serviceable: false },
      { pincode: "400001", serviceable: false },
      { pincode: "380015", serviceable: true },
      { pincode: "abc", serviceable: false },
    ]);
    expect(d).toEqual([
      { pincode: "400001", checks: 2, serviceable: false },
      { pincode: "380015", checks: 1, serviceable: true },
    ]);
    expect(postalRegion("400001")).toBe("Maharashtra (Mumbai)");
    expect(postalRegion("110001")).toBe("Delhi");
    expect(postalRegion("990001")).toBe("Other");
  });
});

/* ------------------------------------------------------ payment health */

const attempt = (a: Partial<AttemptLike>): AttemptLike => ({
  orderId: `o-${Math.random()}`,
  method: "upi",
  status: "CAPTURED",
  createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
  errorSource: null,
  errorReason: null,
  ...a,
});

describe("payment health", () => {
  it("computes the Wilson interval", () => {
    const w = wilson(5, 10)!;
    expect(w.low).toBeCloseTo(0.237, 2);
    expect(w.high).toBeCloseTo(0.763, 2);
    expect(wilson(0, 0)).toBeNull();
  });

  it("doesn't flag an unlucky 7 of 10 against an 85% norm, but does flag 5 of 10", () => {
    expect(judge({ attempts: 10, captured: 7, rate: 0.7 }, 0.85, false).status).toBe("OK");
    expect(judge({ attempts: 10, captured: 5, rate: 0.5 }, 0.9, false).status).toBe("DEGRADED");
    expect(judge({ attempts: 30, captured: 12, rate: 0.4 }, 0.9, false).status).toBe("DOWN");
    expect(judge({ attempts: 4, captured: 1, rate: 0.25 }, 0.9, false).status).toBe("LOW_DATA");
    expect(judge({ attempts: 4, captured: 3, rate: 0.75 }, 0.9, true).status).toBe("DOWN");
  });

  it("leaves shopper-caused failures out", () => {
    expect(customerCaused({ status: "FAILED", errorSource: "customer", errorReason: null })).toBe(true);
    expect(customerCaused({ status: "FAILED", errorSource: "bank", errorReason: "Payment was cancelled" })).toBe(false);
    expect(customerCaused({ status: "FAILED", errorSource: null, errorReason: "UPI collect request expired" })).toBe(true);
    expect(customerCaused({ status: "FAILED", errorSource: null, errorReason: "Payment declined by bank" })).toBe(false);
    expect(customerCaused({ status: "CAPTURED", errorSource: "customer", errorReason: null })).toBe(false);
  });

  it("trips on three gateway failures in a row from two orders within 30 minutes, not one shopper retrying", () => {
    const t = (min: number, orderId: string) => attempt({ status: "FAILED", orderId, createdAt: new Date(NOW.getTime() - min * 60_000) });
    expect(tripwire([t(1, "a"), t(5, "b"), t(9, "a")])).toBe(true);
    expect(tripwire([t(1, "a"), t(5, "a"), t(9, "a")])).toBe(false);
    expect(tripwire([t(1, "a"), t(20, "b"), t(45, "c")])).toBe(false);
    expect(tripwire([attempt({}), t(5, "b"), t(9, "c")])).toBe(false);
  });

  it("judges each method against its own history once there's enough, else the norm", () => {
    const history = Array.from({ length: 120 }, (_, i) =>
      attempt({ method: "card", status: i % 10 === 0 ? "FAILED" : "CAPTURED", createdAt: new Date(NOW.getTime() - (2 + (i % 20)) * DAY) }),
    );
    const recent = Array.from({ length: 30 }, (_, i) =>
      attempt({ method: "card", status: i < 14 ? "FAILED" : "CAPTURED", errorSource: i < 14 ? "bank" : null, createdAt: new Date(NOW.getTime() - (i * 40 + 5) * 60_000) }),
    );
    const upi = Array.from({ length: 12 }, () => attempt({}));
    const shopperGaveUp = Array.from({ length: 6 }, () => attempt({ status: "FAILED", errorSource: "customer" }));
    const health = paymentHealth([...history, ...recent, ...upi, ...shopperGaveUp], NOW);
    const card = health.find((m) => m.method === "card")!;
    expect(card.baselineFrom).toBe("history");
    expect(card.baseline).toBeCloseTo(0.9);
    // 16 of 30: at best about 70%, well under the usual 90%, though not past the "down" margin.
    expect(card.status).toBe("DEGRADED");
    const u = health.find((m) => m.method === "upi")!;
    expect(u.baselineFrom).toBe("norm");
    expect(u.recent.attempts).toBe(12); // the shopper's own failures aren't counted...
    expect(u.attemptRate.attempts).toBe(18); // ...except in the attempt rate
    expect(u.status).toBe("OK");
    expect(u.daily).toHaveLength(8);
    expect(overallStatus(health)).toBe("DEGRADED");
    expect(overallStatus([])).toBe("LOW_DATA");
  });
});

/* ------------------------------------------------------------ customers */

const co = (o: Partial<CustomerOrder>): CustomerOrder => ({
  id: `o-${Math.random()}`,
  customerId: null,
  phone: "9876543210",
  email: "asha@example.com",
  name: "Asha Patel",
  status: "DELIVERED",
  cod: true,
  totalPaise: 600_00,
  marginPaise: 200_00,
  placedAt: new Date("2026-07-01T06:00:00Z"),
  pincode: "380015",
  sessionId: "s1",
  ...o,
});

describe("customer profiles", () => {
  it("identifies a buyer by account, then number, then email", () => {
    expect(customerKey({ customerId: "c1", phone: "9", email: "e" })).toBe("c:c1");
    expect(customerKey({ customerId: null, phone: "9876543210", email: "e" })).toBe("p:9876543210");
    expect(customerKey({ customerId: null, phone: null, email: "Asha@Example.com" })).toBe("e:asha@example.com");
    expect(customerKey({ customerId: null, phone: null, email: null })).toBeNull();
  });

  it("folds guest orders with the same number into the signed-in account", () => {
    const profiles = buildProfiles([co({}), co({ customerId: "c1", placedAt: new Date("2026-08-01T06:00:00Z") })]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].key).toBe("c:c1");
    expect(profiles[0].orders).toBe(2);
  });

  it("counts value from kept orders only, with cadence, next due date and returns", () => {
    const [p] = buildProfiles([
      co({ placedAt: new Date("2026-07-01T06:00:00Z") }),
      co({ placedAt: new Date("2026-07-31T06:00:00Z"), cod: false }),
      co({ placedAt: new Date("2026-08-15T06:00:00Z"), status: "RTO", marginPaise: null }),
      co({ placedAt: new Date("2026-08-30T06:00:00Z"), status: "CANCELLED" }),
    ]);
    expect(p.keptOrders).toBe(2);
    expect(p.ltvPaise).toBe(1200_00);
    expect(p.marginPaise).toBe(400_00);
    expect(p.aovPaise).toBe(600_00);
    expect(p.cadenceDays).toBe(30);
    expect(p.nextExpectedAt?.toISOString()).toBe("2026-08-30T06:00:00.000Z");
    expect(p.rto).toBe(1);
    expect(p.returnRatio).toBeCloseTo(1 / 3);
    expect(p.codShare).toBe(0.75);
  });

  it("scores recency and frequency on fixed bins and names the segment", () => {
    expect([recencyScore(10), recencyScore(45), recencyScore(80), recencyScore(150), recencyScore(400)]).toEqual([5, 4, 3, 2, 1]);
    expect([frequencyScore(1), frequencyScore(2), frequencyScore(3), frequencyScore(4), frequencyScore(6)]).toEqual([1, 2, 3, 4, 5]);
    expect(segmentOf(5, 5)).toBe("Champions");
    expect(segmentOf(5, 1)).toBe("New");
    expect(segmentOf(4, 2)).toBe("Potential loyalist");
    expect(segmentOf(3, 3)).toBe("Loyal");
    expect(segmentOf(2, 4)).toBe("At risk");
    expect(segmentOf(1, 5)).toBe("Can't lose");
    expect(segmentOf(1, 1)).toBe("Hibernating");
  });

  it("ranks monetary value among buyers and leaves out people with nothing kept", () => {
    const profiles = buildProfiles([
      co({ phone: "1111111111", totalPaise: 100_00, placedAt: new Date(NOW.getTime() - 5 * DAY) }),
      co({ phone: "2222222222", totalPaise: 900_00, placedAt: new Date(NOW.getTime() - 200 * DAY) }),
      co({ phone: "3333333333", status: "CANCELLED" }),
    ]);
    const rfm = scoreRfm(profiles, NOW);
    expect(rfm.size).toBe(2);
    expect(rfm.get("p:1111111111")).toMatchObject({ r: 5, f: 1, m: 1, segment: "New" });
    expect(rfm.get("p:2222222222")).toMatchObject({ r: 1, m: 3, segment: "Hibernating" });
  });

  it("builds monthly cohorts with repeat purchase by month, blank for months not reached", () => {
    const c = cohorts(
      [
        co({ phone: "1", placedAt: new Date("2026-07-05T06:00:00Z") }),
        co({ phone: "1", placedAt: new Date("2026-08-05T06:00:00Z") }),
        co({ phone: "2", placedAt: new Date("2026-07-20T06:00:00Z") }),
        co({ phone: "3", placedAt: new Date("2026-09-02T06:00:00Z") }),
      ],
      NOW,
      3,
    );
    expect(c.map((x) => x.month)).toEqual(["2026-07", "2026-09"]);
    expect(c[0]).toEqual({ month: "2026-07", customers: 2, retention: [0.5, 0, null] });
    expect(c[1].retention).toEqual([null, null, null]);
  });

  it("works out acquisition cost and value to date per month", () => {
    const profiles = buildProfiles([
      co({ phone: "1", placedAt: new Date("2026-08-05T06:00:00Z") }),
      co({ phone: "2", placedAt: new Date("2026-08-06T06:00:00Z"), marginPaise: 100_00 }),
    ]);
    const [aug] = unitEconomics(profiles, new Map([["2026-08", 600_00]]));
    expect(aug).toMatchObject({ month: "2026-08", newCustomers: 2, spendPaise: 600_00, cacPaise: 300_00, revenuePerCustomerPaise: 600_00, marginPerCustomerPaise: 150_00 });
    expect(aug.ltvToCac).toBeCloseTo(0.5);
    const [noSpend] = unitEconomics(profiles, new Map());
    expect(noSpend.cacPaise).toBeNull();
    expect(noSpend.ltvToCac).toBeNull();
  });
});
