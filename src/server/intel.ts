import "server-only";
import { unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PINCODE_TAG, SETTINGS_TAG } from "@/lib/cache-tags";
import { decimalToPaise } from "@/lib/format";
import { reportError } from "@/lib/observability";
import { codDecision, codRefusalMessage, type CodRefusal, type CodSettings, type PincodeRuleLike } from "@/lib/intel/pincodes";
import { scoreRtoRisk, type RiskResult } from "@/lib/intel/rto-risk";

/**
 * The admin intelligence engine's reads and the storefront controls it
 * drives (docs/INTELLIGENCE.md). The rules themselves are pure and live in
 * src/lib/intel/; this file only fetches around them.
 *
 * Reports load whole order histories into memory and aggregate there: right
 * for a store with thousands of orders, and every figure then comes from one
 * tested function. Past ~50,000 orders, move the heavy groupings into SQL.
 */

/* ------------------------------------------------ storefront: COD rules */

export interface CheckoutCodSettings extends CodSettings {
  readonly preferredPayment: "ONLINE" | "COD";
}

const DEFAULT_COD_SETTINGS: CheckoutCodSettings = {
  codAutoBlock: false,
  codAutoBlockRtoPercent: 35,
  codAutoBlockMinShipped: 4,
  codMinOrderValue: null,
  codMaxOrderValue: null,
  preferredPayment: "ONLINE",
};

/** The owner's COD settings. Cached and expired on save, like the other store controls. */
export const getCodSettings = unstable_cache(
  async (): Promise<CheckoutCodSettings> => {
    try {
      const row = await db.storeSettings.findUnique({
        where: { id: "default" },
        select: { codAutoBlock: true, codAutoBlockRtoPercent: true, codAutoBlockMinShipped: true, codMinOrderValue: true, codMaxOrderValue: true, preferredPayment: true },
      });
      return row ?? DEFAULT_COD_SETTINGS;
    } catch (error) {
      reportError("cod-settings", error);
      return DEFAULT_COD_SETTINGS;
    }
  },
  ["cod-settings"],
  { revalidate: 3600, tags: [SETTINGS_TAG] },
);

/** The owner's rule for a pincode, if any. Expired when a rule is saved. */
export const getPincodeRule = unstable_cache(
  async (pincode: string): Promise<PincodeRuleLike | null> => {
    const row = await db.pincodeRule.findUnique({ where: { pincode }, select: { codBlocked: true, codAllowed: true, extraDays: true } });
    return row;
  },
  ["pincode-rule"],
  { revalidate: 3600, tags: [PINCODE_TAG] },
);

const FINISHED = ["DELIVERED", "RTO", "RETURNED"] as const;

/**
 * Shipped COD parcels to a pincode that finished, and how many came back.
 * Ten minutes stale at most: a pincode's record moves by one parcel a day.
 */
export const getPincodeRecord = unstable_cache(
  async (pincode: string): Promise<{ codFinished: number; codReturned: number }> => {
    const rows = await db.order.groupBy({
      by: ["status"],
      where: { postalCode: pincode, paymentGateway: "COD", status: { in: [...FINISHED] } },
      _count: { _all: true },
    });
    const codFinished = rows.reduce((s, r) => s + r._count._all, 0);
    const codReturned = rows.find((r) => r.status === "RTO")?._count._all ?? 0;
    return { codFinished, codReturned };
  },
  ["pincode-record"],
  { revalidate: 600, tags: [PINCODE_TAG] },
);

/** The store's COD return rate across every pincode. */
export const getStoreCodRtoRate = unstable_cache(
  async (): Promise<number> => {
    const rows = await db.order.groupBy({
      by: ["status"],
      where: { paymentGateway: "COD", status: { in: [...FINISHED] } },
      _count: { _all: true },
    });
    const finished = rows.reduce((s, r) => s + r._count._all, 0);
    return finished ? (rows.find((r) => r.status === "RTO")?._count._all ?? 0) / finished : 0;
  },
  ["store-cod-rto"],
  { revalidate: 3600, tags: [PINCODE_TAG] },
);

export type CheckoutCod = { allowed: true } | { allowed: false; reason: CodRefusal; message: string };

/** Earlier parcels to this buyer (signed-in account, or number) that came back. */
async function buyerReturned(buyer: { customerId?: string | null; phone?: string | null }): Promise<number> {
  const or: Prisma.OrderWhereInput[] = [
    ...(buyer.customerId ? [{ customerId: buyer.customerId }] : []),
    ...(buyer.phone && /^\d{10}$/.test(buyer.phone) ? [{ guestPhone: buyer.phone }] : []),
  ];
  return or.length ? db.order.count({ where: { OR: or, status: "RTO" } }) : 0;
}

/**
 * Whether checkout offers cash on delivery for this pincode, buyer and total.
 * Fails open (COD allowed) if the rules can't be read: the global COD
 * switch still applies, and a database blip shouldn't change how people pay.
 */
export async function codForCheckout(
  pincode: string | undefined,
  totalPaise: number | null,
  buyer: { customerId?: string | null; phone?: string | null } = {},
): Promise<CheckoutCod> {
  try {
    const settings = await getCodSettings();
    const valid = pincode && /^\d{6}$/.test(pincode);
    const [rule, record, returned] = await Promise.all([
      valid ? getPincodeRule(pincode) : null,
      valid && settings.codAutoBlock ? getPincodeRecord(pincode) : null,
      buyerReturned(buyer),
    ]);
    const decision = codDecision({ rule, record, settings, totalPaise, buyerReturned: returned });
    return decision.allowed ? decision : { ...decision, message: codRefusalMessage(decision.reason, settings) };
  } catch (error) {
    reportError("cod-for-checkout", error, { pincode });
    return { allowed: true };
  }
}

/** Days the owner has added to the delivery promise for this pincode. */
export async function extraDeliveryDays(pincode: string | undefined): Promise<number> {
  if (!pincode || !/^\d{6}$/.test(pincode)) return 0;
  try {
    return Math.max(0, (await getPincodeRule(pincode))?.extraDays ?? 0);
  } catch (error) {
    reportError("pincode-extra-days", error, { pincode });
    return 0;
  }
}

/**
 * Payment methods Razorpay says are having an outage right now (medium or
 * high severity), for a note at checkout. A minute stale at most.
 */
export const getDownMethods = unstable_cache(
  async (): Promise<string[]> => {
    try {
      const rows = await db.paymentDowntime.findMany({
        where: {
          status: { not: "resolved" },
          severity: { in: ["medium", "high"] },
          beginAt: { lte: new Date() },
          OR: [{ endAt: null }, { endAt: { gt: new Date() } }],
        },
        select: { method: true },
      });
      return [...new Set(rows.map((r) => r.method.toLowerCase()))];
    } catch (error) {
      reportError("payment-downtime", error);
      return [];
    }
  },
  ["payment-down-methods"],
  // Expired when the owner turns a payment note on or off (Insights, Copilot).
  { revalidate: 60, tags: [SETTINGS_TAG] },
);

/* ------------------------------------------------- order risk at placement */

/**
 * Score a just-placed order and store it on the order, for the dispatch
 * queue. Runs after the response (the shopper never waits on it) and never
 * throws: a missing score just means the queue works it out on the fly.
 */
export async function recordOrderRisk(orderId: string): Promise<RiskResult | null> {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, customerId: true, guestPhone: true, phoneVerifiedAt: true, paymentGateway: true, totalAmount: true,
        placedAt: true, postalCode: true, shippingAddress: true, items: { select: { productId: true, quantity: true } },
      },
    });
    if (!order) return null;
    const buyer: Prisma.OrderWhereInput[] = [
      ...(order.customerId ? [{ customerId: order.customerId }] : []),
      ...(order.guestPhone ? [{ guestPhone: order.guestPhone }] : []),
    ];
    const dayBefore = new Date(order.placedAt.getTime() - 24 * 60 * 60 * 1000);
    const [history, recentOpenCod, pincode, storeRate] = await Promise.all([
      buyer.length
        ? db.order.groupBy({ by: ["status", "paymentGateway"], where: { id: { not: order.id }, OR: buyer, status: { in: ["DELIVERED", "RTO"] } }, _count: { _all: true } })
        : Promise.resolve([]),
      buyer.length && order.paymentGateway === "COD"
        ? db.order.count({ where: { id: { not: order.id }, OR: buyer, paymentGateway: "COD", status: { in: ["PROCESSING", "PAID"] }, placedAt: { gte: dayBefore } } })
        : Promise.resolve(0),
      order.postalCode ? getPincodeRecord(order.postalCode) : Promise.resolve(null),
      getStoreCodRtoRate(),
    ]);
    const count = (status: string, prepaid?: boolean) =>
      history.filter((h) => h.status === status && (prepaid === undefined || (h.paymentGateway !== "COD") === prepaid)).reduce((s, h) => s + h._count._all, 0);
    const result = scoreRtoRisk(riskInputFor(order, {
      priorDelivered: count("DELIVERED"),
      priorReturnedToOrigin: count("RTO"),
      priorPrepaidDelivered: count("DELIVERED", true),
      recentOpenCod,
      pincode,
      storeCodRtoRate: storeRate,
    }));
    await db.order.update({
      where: { id: order.id },
      data: { riskScore: result.score, riskReasons: result.reasons as unknown as Prisma.InputJsonValue },
    });
    return result;
  } catch (error) {
    reportError("order-risk", error, { orderId });
    return null;
  }
}

type RiskOrder = {
  paymentGateway: string | null;
  totalAmount: { toString(): string };
  placedAt: Date;
  phoneVerifiedAt: Date | null;
  shippingAddress: Prisma.JsonValue;
  items: readonly { productId: string; quantity: number }[];
};

export function riskInputFor(
  order: RiskOrder,
  context: {
    priorDelivered: number;
    priorReturnedToOrigin: number;
    priorPrepaidDelivered: number;
    recentOpenCod: number;
    pincode: { codFinished: number; codReturned: number } | null;
    storeCodRtoRate: number;
  },
) {
  const address = (order.shippingAddress ?? {}) as { line1?: string; line2?: string | null };
  const perProduct = new Map<string, number>();
  for (const i of order.items) perProduct.set(i.productId, (perProduct.get(i.productId) ?? 0) + i.quantity);
  return {
    cod: order.paymentGateway === "COD",
    totalPaise: decimalToPaise(order.totalAmount),
    units: order.items.reduce((s, i) => s + i.quantity, 0),
    maxUnitsOfOneProduct: Math.max(0, ...perProduct.values()),
    placedAt: order.placedAt,
    phoneVerified: Boolean(order.phoneVerifiedAt),
    address: [address.line1, address.line2].filter(Boolean).join(", "),
    ...context,
  };
}
