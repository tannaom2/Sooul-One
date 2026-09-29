import "server-only";
import { db } from "@/lib/db";
import { decimalToPaise } from "@/lib/format";
import { pincodeStats, storeCodRtoRate, demandByPincode, autoBlocks, postalRegion, type PincodeOrder, type PincodeStats } from "@/lib/intel/pincodes";
import { paymentHealth } from "@/lib/intel/payment-health";
import { buildProfiles, cohorts, scoreRfm, unitEconomics, monthKey, type CustomerOrder, type CustomerProfile } from "@/lib/intel/customers";
import { scoreRtoRisk, type RiskReason } from "@/lib/intel/rto-risk";
import { getCodSettings, riskInputFor } from "@/server/intel";

/**
 * Loaders for Analytics → Pincodes, Payments, Customers and RTO risk
 * (src/app/admin/(console)/analytics). Admin-only reads; every figure comes
 * from a pure function in src/lib/intel/.
 */

const DAY = 24 * 60 * 60 * 1000;

type Address = { name?: string; city?: string; line1?: string; line2?: string | null; postalCode?: string };

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  customerId: true,
  guestPhone: true,
  guestEmail: true,
  phoneVerifiedAt: true,
  status: true,
  paymentGateway: true,
  totalAmount: true,
  placedAt: true,
  deliveredAt: true,
  promisedDeliveryDate: true,
  postalCode: true,
  shippingAddress: true,
  sessionId: true,
  riskScore: true,
  riskReasons: true,
  closeReason: true,
  items: { select: { productId: true, quantity: true, lineTotal: true, taxableAmount: true } },
} as const;

async function orderHistory(since?: Date) {
  const [orders, costs] = await Promise.all([
    db.order.findMany({ where: since ? { placedAt: { gte: since } } : undefined, select: ORDER_SELECT, orderBy: { placedAt: "asc" } }),
    db.product.findMany({ where: { unitCost: { not: null } }, select: { id: true, unitCost: true } }),
  ]);
  const costOf = new Map(costs.map((p) => [p.id, decimalToPaise(p.unitCost)]));
  return orders.map((o) => {
    const address = (o.shippingAddress ?? {}) as Address;
    // Margin: what the goods sold for before GST, less their landed cost.
    // Unknown when any line's product has no landed cost entered.
    const margin = o.items.every((i) => costOf.has(i.productId))
      ? o.items.reduce((s, i) => s + decimalToPaise(i.taxableAmount ?? i.lineTotal) - (costOf.get(i.productId) ?? 0) * i.quantity, 0)
      : null;
    return { ...o, address, pincode: o.postalCode ?? address.postalCode ?? null, totalPaise: decimalToPaise(o.totalAmount), marginPaise: margin, cod: o.paymentGateway === "COD" };
  });
}

export type HistoryOrder = Awaited<ReturnType<typeof orderHistory>>[number];

/**
 * The whole order history, loaded once, for callers that run several reports
 * together (the copilot's context): each report otherwise loads it itself,
 * and with the database far from the app every load is seconds.
 */
export function loadOrderHistory(): Promise<HistoryOrder[]> {
  return orderHistory();
}

function toPincodeOrder(o: HistoryOrder): PincodeOrder | null {
  return o.pincode
    ? { pincode: o.pincode, city: o.address.city ?? null, status: o.status, cod: o.cod, totalPaise: o.totalPaise, placedAt: o.placedAt, deliveredAt: o.deliveredAt, promisedDeliveryDate: o.promisedDeliveryDate }
    : null;
}

function toCustomerOrder(o: HistoryOrder): CustomerOrder {
  return {
    id: o.id, customerId: o.customerId, phone: o.guestPhone, email: o.guestEmail, name: o.address.name ?? null, status: o.status,
    cod: o.cod, totalPaise: o.totalPaise, marginPaise: o.marginPaise, placedAt: o.placedAt, pincode: o.pincode, sessionId: o.sessionId,
  };
}

/* ------------------------------------------------------------- pincodes */

export type PincodeSort = "orders" | "rto" | "slow" | "revenue";

export interface PincodeRow extends PincodeStats {
  readonly rule: { codBlocked: boolean; codAllowed: boolean; extraDays: number; note: string | null } | null;
  /** COD offered at checkout right now (all-time record, owner's rule, automatic rule). */
  readonly codOffered: boolean;
  readonly autoBlocked: boolean;
}

export async function pincodeReport(days: number, sort: PincodeSort, preloaded?: readonly HistoryOrder[]) {
  const since = new Date(Date.now() - days * DAY);
  const [history, rules, settings, checks] = await Promise.all([
    preloaded ?? orderHistory(),
    db.pincodeRule.findMany(),
    getCodSettings(),
    db.analyticsEvent.findMany({ where: { type: "PINCODE_CHECKED", createdAt: { gte: since } }, select: { metadata: true } }),
  ]);
  const all = history.map(toPincodeOrder).filter((o): o is PincodeOrder => o !== null);
  const allTime = new Map(pincodeStats(all).map((s) => [s.pincode, s]));
  const windowStats = pincodeStats(all.filter((o) => o.placedAt >= since));
  const ruleOf = new Map(rules.map((r) => [r.pincode, r]));
  const baseline = storeCodRtoRate([...allTime.values()]);

  const rows: PincodeRow[] = windowStats.map((s) => {
    const rule = ruleOf.get(s.pincode) ?? null;
    const record = allTime.get(s.pincode) ?? null;
    const autoBlocked = autoBlocks(record, settings);
    return {
      ...s,
      rule: rule && { codBlocked: rule.codBlocked, codAllowed: rule.codAllowed, extraDays: rule.extraDays, note: rule.note },
      autoBlocked,
      codOffered: !rule?.codBlocked && (rule?.codAllowed || !autoBlocked),
    };
  });
  // Pincodes with a rule but no orders in the window still need to be findable.
  for (const rule of rules) {
    if (rows.some((r) => r.pincode === rule.pincode)) continue;
    const record = allTime.get(rule.pincode);
    rows.push({
      pincode: rule.pincode, city: record?.city ?? null, orders: 0, codOrders: 0, codShare: 0, delivered: 0, rto: 0, returned: 0, cancelled: 0,
      successRate: null, codFinished: 0, codReturned: 0, codRtoRate: null, avgDeliveryDays: null, onTimeRate: null, revenuePaise: 0,
      rule: { codBlocked: rule.codBlocked, codAllowed: rule.codAllowed, extraDays: rule.extraDays, note: rule.note },
      autoBlocked: autoBlocks(record ?? null, settings),
      codOffered: !rule.codBlocked && (rule.codAllowed || !autoBlocks(record ?? null, settings)),
    });
  }

  const by: Record<PincodeSort, (a: PincodeRow, b: PincodeRow) => number> = {
    orders: (a, b) => b.orders - a.orders,
    revenue: (a, b) => b.revenuePaise - a.revenuePaise,
    rto: (a, b) => (b.codRtoRate ?? -1) - (a.codRtoRate ?? -1) || b.codFinished - a.codFinished,
    slow: (a, b) => (b.avgDeliveryDays ?? -1) - (a.avgDeliveryDays ?? -1),
  };
  rows.sort((a, b) => by[sort](a, b) || a.pincode.localeCompare(b.pincode));

  const demand = demandByPincode(
    checks
      .map((c) => c.metadata as { pincode?: string; serviceable?: boolean } | null)
      .filter((m): m is { pincode: string; serviceable: boolean } => typeof m?.pincode === "string")
      .map((m) => ({ pincode: m.pincode, serviceable: Boolean(m.serviceable) })),
  );
  const outside = new Map<string, number>();
  for (const d of demand.filter((d) => !d.serviceable)) outside.set(postalRegion(d.pincode), (outside.get(postalRegion(d.pincode)) ?? 0) + d.checks);

  const inWindow = windowStats;
  const sum = (fn: (s: PincodeStats) => number) => inWindow.reduce((t, s) => t + fn(s), 0);
  const delivered = sum((s) => s.delivered);
  const ended = delivered + sum((s) => s.rto) + sum((s) => s.returned);
  const deliveredDays = inWindow.filter((s) => s.avgDeliveryDays !== null);
  return {
    rows,
    settings,
    baseline,
    totals: {
      pincodes: inWindow.length,
      orders: sum((s) => s.orders),
      codShare: sum((s) => s.orders) ? sum((s) => s.codOrders) / sum((s) => s.orders) : 0,
      successRate: ended ? delivered / ended : null,
      codRtoRate: sum((s) => s.codFinished) ? sum((s) => s.codReturned) / sum((s) => s.codFinished) : null,
      avgDeliveryDays: deliveredDays.length
        ? deliveredDays.reduce((t, s) => t + (s.avgDeliveryDays ?? 0) * s.delivered, 0) / Math.max(1, deliveredDays.reduce((t, s) => t + s.delivered, 0))
        : null,
    },
    demand: {
      checks: demand.reduce((t, d) => t + d.checks, 0),
      outsideChecks: demand.filter((d) => !d.serviceable).reduce((t, d) => t + d.checks, 0),
      outsideRegions: [...outside.entries()].map(([region, checks]) => ({ region, checks })).sort((a, b) => b.checks - a.checks),
      topOutside: demand.filter((d) => !d.serviceable).slice(0, 8),
    },
  };
}

/* ------------------------------------------------------------- payments */

export async function paymentReport(now = new Date()) {
  // 28 days of baseline before the recent window, plus the window itself.
  const since = new Date(now.getTime() - 30 * DAY);
  const monthAgo = new Date(now.getTime() - 30 * DAY);
  const [downtimes, attempts, onlineOrders, codOrders, dismissals, choices] = await Promise.all([
    db.paymentDowntime.findMany({ where: { OR: [{ status: { not: "resolved" } }, { beginAt: { gte: new Date(now.getTime() - 7 * DAY) } }] }, orderBy: { beginAt: "desc" }, take: 20 }),
    db.paymentAttempt.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" } }),
    db.order.findMany({ where: { paymentGateway: "RAZORPAY", placedAt: { gte: monthAgo } }, select: { status: true, placedAt: true } }),
    db.order.findMany({ where: { paymentGateway: "COD", placedAt: { gte: monthAgo } }, select: { status: true, closeReason: true } }),
    db.analyticsEvent.count({ where: { type: "PAYMENT_DISMISSED", createdAt: { gte: monthAgo } } }),
    db.analyticsEvent.findMany({ where: { type: "PAYMENT_METHOD_SELECTED", createdAt: { gte: monthAgo } }, select: { metadata: true } }),
  ]);
  const health = paymentHealth(attempts, now);
  const paidStatuses = new Set(["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "RTO", "RETURNED", "REFUNDED"]);
  const perDay = Array.from({ length: 30 }, (_, i) => {
    const from = now.getTime() - (30 - i) * DAY;
    const day = onlineOrders.filter((o) => o.placedAt.getTime() >= from && o.placedAt.getTime() < from + DAY);
    return {
      label: new Date(from + DAY / 2).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }),
      value: day.length ? day.filter((o) => paidStatuses.has(o.status)).length / day.length : null,
    };
  });
  const chosen = new Map<string, number>();
  for (const c of choices) {
    const method = (c.metadata as { method?: string } | null)?.method;
    if (method) chosen.set(method, (chosen.get(method) ?? 0) + 1);
  }
  return {
    health,
    downtimes,
    failures: attempts.filter((a) => a.status === "FAILED"),
    online: {
      orders: onlineOrders.length,
      completed: onlineOrders.filter((o) => paidStatuses.has(o.status)).length,
      abandoned: onlineOrders.filter((o) => o.status === "PENDING_PAYMENT" || o.status === "FAILED").length,
      perDay,
    },
    cod: {
      orders: codOrders.length,
      unconfirmed: codOrders.filter((o) => o.status === "CANCELLED" && o.closeReason === "UNCONFIRMED_COD").length,
      rto: codOrders.filter((o) => o.status === "RTO").length,
      delivered: codOrders.filter((o) => o.status === "DELIVERED").length,
    },
    dismissals,
    chosen: [...chosen.entries()].map(([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count),
  };
}

/* ------------------------------------------------------------ customers */

export async function customerData(now = new Date(), preloaded?: readonly HistoryOrder[]) {
  const [history, spend] = await Promise.all([preloaded ?? orderHistory(), db.marketingSpend.findMany({ orderBy: { month: "asc" } })]);
  const orders = history.map(toCustomerOrder);
  const profiles = buildProfiles(orders);
  const rfm = scoreRfm(profiles, now);
  const spendByMonth = new Map(spend.map((s) => [s.month, decimalToPaise(s.amount)]));
  return { profiles, rfm, cohorts: cohorts(orders, now), economics: unitEconomics(profiles, spendByMonth), spend, history };
}

/** One buyer's profile, their orders, and what their sessions show. */
export async function customerDetail(key: string, now = new Date()) {
  const data = await customerData(now);
  const profile = data.profiles.find((p) => p.key === key);
  if (!profile) return null;
  const orders = data.history.filter((o) => profile.orderIds.includes(o.id)).reverse();
  const account = key.startsWith("c:")
    ? await db.customer.findUnique({ where: { id: key.slice(2) }, select: { id: true, createdAt: true, lastSignInAt: true, marketingConsent: true, cart: { select: { sessionId: true } } } })
    : null;
  const sessions = [...new Set([...profile.sessionIds, ...(account?.cart?.sessionId ? [account.cart.sessionId] : [])])];
  const events = sessions.length
    ? await db.analyticsEvent.groupBy({ by: ["sessionId", "type"], where: { sessionId: { in: sessions }, type: { in: ["CHECKOUT_STARTED", "ORDER_PLACED", "ADD_TO_CART", "PRODUCT_VIEW"] } }, _count: { _all: true } })
    : [];
  const sessionsWith = (type: string) => new Set(events.filter((e) => e.type === type).map((e) => e.sessionId));
  const started = sessionsWith("CHECKOUT_STARTED");
  const placed = sessionsWith("ORDER_PLACED");
  return {
    profile,
    rfm: data.rfm.get(profile.key) ?? null,
    orders,
    account,
    behaviour: {
      productViews: events.filter((e) => e.type === "PRODUCT_VIEW").reduce((s, e) => s + e._count._all, 0),
      addToCart: events.filter((e) => e.type === "ADD_TO_CART").reduce((s, e) => s + e._count._all, 0),
      checkoutsStarted: started.size,
      abandonedCheckouts: [...started].filter((s) => !placed.has(s)).length,
    },
  };
}

export type { CustomerProfile };
export { monthKey };

/* ------------------------------------------------------------- RTO risk */

export interface QueuedOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly name: string;
  readonly pincode: string | null;
  readonly cod: boolean;
  readonly totalPaise: number;
  readonly placedAt: Date;
  readonly status: string;
  readonly score: number;
  readonly reasons: readonly RiskReason[];
  /** Worked out now, because the order predates stored scores. */
  readonly computed: boolean;
}

/** Orders not yet dispatched, riskiest first: who to call before packing. */
export async function riskQueue(preloaded?: readonly HistoryOrder[]): Promise<QueuedOrder[]> {
  const history = preloaded ?? (await orderHistory());
  const open = history.filter((o) => o.status === "PAID" || o.status === "PROCESSING");
  if (open.length === 0) return [];
  const allStats = new Map(pincodeStats(history.map(toPincodeOrder).filter((o): o is PincodeOrder => o !== null)).map((s) => [s.pincode, s]));
  const baseline = storeCodRtoRate([...allStats.values()]);
  const byBuyer = new Map<string, { delivered: number; rto: number; prepaid: number }>();
  const buyerKeys = (o: HistoryOrder) => [o.customerId && `c:${o.customerId}`, o.guestPhone && `p:${o.guestPhone}`].filter((k): k is string => Boolean(k));
  for (const o of history) {
    if (o.status !== "DELIVERED" && o.status !== "RTO") continue;
    for (const k of buyerKeys(o)) {
      const b = byBuyer.get(k) ?? { delivered: 0, rto: 0, prepaid: 0 };
      if (o.status === "DELIVERED") {
        b.delivered += 1;
        if (!o.cod) b.prepaid += 1;
      } else b.rto += 1;
      byBuyer.set(k, b);
    }
  }
  return open
    .map((o) => {
      const stored = o.riskScore !== null && Array.isArray(o.riskReasons);
      let score = o.riskScore ?? 0;
      let reasons: readonly RiskReason[] = (o.riskReasons as unknown as RiskReason[]) ?? [];
      if (!stored) {
        const past = buyerKeys(o).map((k) => byBuyer.get(k)).filter(Boolean) as { delivered: number; rto: number; prepaid: number }[];
        const keys = new Set(buyerKeys(o));
        const recentOpenCod = open.filter(
          (x) => x.id !== o.id && x.cod && buyerKeys(x).some((k) => keys.has(k)) && Math.abs(x.placedAt.getTime() - o.placedAt.getTime()) <= DAY && x.placedAt < o.placedAt,
        ).length;
        const record = o.pincode ? allStats.get(o.pincode) : undefined;
        const result = scoreRtoRisk(riskInputFor({ ...o, items: o.items }, {
          priorDelivered: Math.max(0, ...past.map((p) => p.delivered)),
          priorReturnedToOrigin: Math.max(0, ...past.map((p) => p.rto)),
          priorPrepaidDelivered: Math.max(0, ...past.map((p) => p.prepaid)),
          recentOpenCod,
          pincode: record ? { codFinished: record.codFinished, codReturned: record.codReturned } : null,
          storeCodRtoRate: baseline,
        }));
        score = result.score;
        reasons = result.reasons;
      }
      return {
        id: o.id, orderNumber: o.orderNumber, name: o.address.name ?? "—", pincode: o.pincode, cod: o.cod, totalPaise: o.totalPaise,
        placedAt: o.placedAt, status: o.status, score, reasons, computed: !stored,
      };
    })
    .sort((a, b) => b.score - a.score || a.placedAt.getTime() - b.placedAt.getTime());
}
