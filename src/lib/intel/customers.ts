/**
 * Customer 360: one profile per buyer, their RFM segment, and monthly cohort
 * retention. Pure, so it's tested directly (tests/intel.test.ts).
 *
 * A buyer is their account when they signed in, otherwise their mobile
 * number, otherwise their email: most orders are guest checkouts, and the
 * number is what a courier and a COD confirmation actually use.
 */

export interface CustomerOrder {
  readonly id: string;
  readonly customerId: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly name: string | null;
  readonly status: string;
  readonly cod: boolean;
  readonly totalPaise: number;
  /** Revenue minus landed cost of the goods, when costs are known. */
  readonly marginPaise: number | null;
  readonly placedAt: Date;
  readonly pincode: string | null;
  readonly sessionId: string | null;
}

/** Orders that count towards what a buyer is worth: money kept or on its way. */
export const KEPT_STATUSES = new Set(["PAID", "PROCESSING", "SHIPPED", "DELIVERED"]);
const CAME_BACK = new Set(["RTO", "RETURNED", "REFUNDED"]);
const FINISHED = new Set(["DELIVERED", "RTO", "RETURNED", "REFUNDED"]);

export function customerKey(o: Pick<CustomerOrder, "customerId" | "phone" | "email">): string | null {
  if (o.customerId) return `c:${o.customerId}`;
  if (o.phone) return `p:${o.phone}`;
  if (o.email) return `e:${o.email.toLowerCase()}`;
  return null;
}

export interface CustomerProfile {
  readonly key: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly orders: number;
  readonly keptOrders: number;
  /** Lifetime value: kept revenue. */
  readonly ltvPaise: number;
  /** Kept revenue minus landed cost, when every kept order's cost is known. */
  readonly marginPaise: number | null;
  readonly aovPaise: number;
  readonly firstOrderAt: Date;
  readonly lastOrderAt: Date;
  /** Average days between kept orders; null with fewer than two. */
  readonly cadenceDays: number | null;
  /** When the next order is due at their usual pace; null without a pace. */
  readonly nextExpectedAt: Date | null;
  readonly rto: number;
  readonly returned: number;
  /** Came back (RTO, returned, refunded) out of finished orders. Null before any finished. */
  readonly returnRatio: number | null;
  readonly codShare: number;
  readonly pincodes: readonly string[];
  readonly sessionIds: readonly string[];
  readonly orderIds: readonly string[];
}

const DAY = 24 * 60 * 60 * 1000;

export function buildProfiles(orders: readonly CustomerOrder[]): CustomerProfile[] {
  const groups = new Map<string, CustomerOrder[]>();
  // Signed-in orders carry the number too: fold guest orders with the same
  // number into the account, so one person is one profile.
  const accountByPhone = new Map<string, string>();
  for (const o of orders) if (o.customerId && o.phone) accountByPhone.set(o.phone, `c:${o.customerId}`);
  for (const o of orders) {
    const key = (o.phone && accountByPhone.get(o.phone)) || customerKey(o);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
  }

  return [...groups.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());
    const kept = sorted.filter((o) => KEPT_STATUSES.has(o.status));
    const ltvPaise = kept.reduce((s, o) => s + o.totalPaise, 0);
    const margins = kept.map((o) => o.marginPaise);
    const gaps = kept.slice(1).map((o, i) => (o.placedAt.getTime() - kept[i].placedAt.getTime()) / DAY);
    const cadenceDays = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    const last = sorted[sorted.length - 1];
    const lastKept = kept[kept.length - 1];
    const finished = sorted.filter((o) => FINISHED.has(o.status)).length;
    const cameBack = sorted.filter((o) => CAME_BACK.has(o.status)).length;
    const latestNamed = [...sorted].reverse().find((o) => o.name);
    return {
      key,
      name: latestNamed?.name ?? "—",
      phone: [...sorted].reverse().find((o) => o.phone)?.phone ?? null,
      email: [...sorted].reverse().find((o) => o.email)?.email ?? null,
      orders: sorted.length,
      keptOrders: kept.length,
      ltvPaise,
      marginPaise: margins.length && margins.every((m) => m !== null) ? margins.reduce((s, m) => s + (m ?? 0), 0) : null,
      aovPaise: kept.length ? Math.round(ltvPaise / kept.length) : 0,
      firstOrderAt: sorted[0].placedAt,
      lastOrderAt: last.placedAt,
      cadenceDays,
      nextExpectedAt: cadenceDays !== null && lastKept ? new Date(lastKept.placedAt.getTime() + cadenceDays * DAY) : null,
      rto: sorted.filter((o) => o.status === "RTO").length,
      returned: sorted.filter((o) => o.status === "RETURNED").length,
      returnRatio: finished ? cameBack / finished : null,
      codShare: sorted.filter((o) => o.cod).length / sorted.length,
      pincodes: [...new Set(sorted.map((o) => o.pincode).filter((p): p is string => Boolean(p)))],
      sessionIds: [...new Set(sorted.map((o) => o.sessionId).filter((s): s is string => Boolean(s)))],
      orderIds: sorted.map((o) => o.id),
    };
  });
}

/* ------------------------------------------------------------------ RFM */

export type Segment =
  | "Champions"
  | "Loyal"
  | "Potential loyalist"
  | "New"
  | "Needs attention"
  | "At risk"
  | "About to sleep"
  | "Can't lose"
  | "Hibernating";

export interface Rfm {
  readonly r: number;
  readonly f: number;
  readonly m: number;
  readonly segment: Segment;
}

/**
 * Recency and frequency on fixed bins rather than quintiles: a small store's
 * quintiles move every week and would reshuffle everyone's segment, while
 * "bought in the last 30 days" means the same thing in month one and year
 * three. Monetary is ranked against the other buyers (quintiles), since what
 * counts as a big spender depends on the catalogue.
 */
export function recencyScore(daysSince: number): number {
  return daysSince <= 30 ? 5 : daysSince <= 60 ? 4 : daysSince <= 90 ? 3 : daysSince <= 180 ? 2 : 1;
}

export function frequencyScore(keptOrders: number): number {
  return keptOrders >= 6 ? 5 : keptOrders >= 4 ? 4 : keptOrders === 3 ? 3 : keptOrders === 2 ? 2 : 1;
}

export function segmentOf(r: number, f: number): Segment {
  if (r >= 4) return f >= 4 ? "Champions" : f >= 2 ? "Potential loyalist" : "New";
  if (r === 3) return f >= 3 ? "Loyal" : "Needs attention";
  if (r === 2) return f >= 3 ? "At risk" : "About to sleep";
  return f >= 3 ? "Can't lose" : "Hibernating";
}

/** What to do about each segment, shown next to it. */
export const SEGMENT_ACTION: Record<Segment, string> = {
  Champions: "Ask for reviews and referrals; early access to new flavours.",
  Loyal: "Offer a Make Your Own Box or a subscription-style reminder.",
  "Potential loyalist": "Nudge the second or third order with a bundle.",
  New: "Welcome series; make sure the first parcel arrives on time.",
  "Needs attention": "A reminder when their usual reorder date passes.",
  "At risk": "Win-back message with a reason to return.",
  "About to sleep": "One gentle reminder; don't discount yet.",
  "Can't lose": "Personal win-back: they used to buy often.",
  Hibernating: "Low priority; include in seasonal campaigns only.",
};

export function scoreRfm(profiles: readonly CustomerProfile[], now: Date): Map<string, Rfm> {
  const buyers = profiles.filter((p) => p.keptOrders > 0);
  const byValue = [...buyers].sort((a, b) => a.ltvPaise - b.ltvPaise);
  const result = new Map<string, Rfm>();
  byValue.forEach((p, i) => {
    const m = Math.min(5, Math.floor((i / Math.max(1, byValue.length)) * 5) + 1);
    const r = recencyScore((now.getTime() - p.lastOrderAt.getTime()) / DAY);
    const f = frequencyScore(p.keptOrders);
    result.set(p.key, { r, f, m, segment: segmentOf(r, f) });
  });
  return result;
}

/* -------------------------------------------------------------- cohorts */

export interface Cohort {
  /** "2026-07" */
  readonly month: string;
  readonly customers: number;
  /** Share of the cohort ordering again in month +1, +2, ...; null for months not reached yet. */
  readonly retention: readonly (number | null)[];
}

export function monthKey(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthIndex(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
}

/** Monthly cohorts by first kept order, with repeat purchase in each later month. */
export function cohorts(orders: readonly CustomerOrder[], now: Date, horizon = 5): Cohort[] {
  const byCustomer = new Map<string, Set<number>>();
  const byId = new Map(orders.map((o) => [o.id, o]));
  for (const p of buildProfiles(orders.filter((o) => KEPT_STATUSES.has(o.status)))) {
    const months = new Set<number>();
    for (const id of p.orderIds) {
      const order = byId.get(id);
      if (order) months.add(monthIndex(monthKey(order.placedAt)));
    }
    byCustomer.set(p.key, months);
  }
  const current = monthIndex(monthKey(now));
  const groups = new Map<number, Set<number>[]>();
  for (const months of byCustomer.values()) {
    const first = Math.min(...months);
    (groups.get(first) ?? groups.set(first, []).get(first)!).push(months);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([first, members]) => ({
      month: `${Math.floor(first / 12)}-${String((first % 12) + 1).padStart(2, "0")}`,
      customers: members.length,
      retention: Array.from({ length: horizon }, (_, i) => {
        const offset = i + 1;
        if (first + offset > current) return null;
        return members.filter((m) => m.has(first + offset)).length / members.length;
      }),
    }));
}

/* -------------------------------------------------------- unit economics */

export interface MonthEconomics {
  readonly month: string;
  readonly newCustomers: number;
  readonly spendPaise: number | null;
  /** Acquisition cost per new customer; null without spend or new customers. */
  readonly cacPaise: number | null;
  /** Average kept revenue to date per customer acquired that month. */
  readonly revenuePerCustomerPaise: number;
  /** Average margin to date per customer acquired that month, when costs are known. */
  readonly marginPerCustomerPaise: number | null;
  /** Lifetime value to date over acquisition cost (margin-based when costs are known). */
  readonly ltvToCac: number | null;
}

export function unitEconomics(profiles: readonly CustomerProfile[], spendByMonth: ReadonlyMap<string, number>): MonthEconomics[] {
  const byMonth = new Map<string, CustomerProfile[]>();
  for (const p of profiles) {
    if (p.keptOrders === 0) continue;
    const key = monthKey(p.firstOrderAt);
    (byMonth.get(key) ?? byMonth.set(key, []).get(key)!).push(p);
  }
  const months = new Set([...byMonth.keys(), ...spendByMonth.keys()]);
  return [...months].sort().map((month) => {
    const members = byMonth.get(month) ?? [];
    const spendPaise = spendByMonth.get(month) ?? null;
    const n = members.length;
    const cacPaise = spendPaise !== null && n > 0 ? Math.round(spendPaise / n) : null;
    const revenuePerCustomerPaise = n ? Math.round(members.reduce((s, p) => s + p.ltvPaise, 0) / n) : 0;
    const margins = members.map((p) => p.marginPaise);
    const marginPerCustomerPaise = n && margins.every((m) => m !== null) ? Math.round(margins.reduce((s, m) => s + (m ?? 0), 0) / n) : null;
    const value = marginPerCustomerPaise ?? revenuePerCustomerPaise;
    return {
      month,
      newCustomers: n,
      spendPaise,
      cacPaise,
      revenuePerCustomerPaise,
      marginPerCustomerPaise,
      ltvToCac: cacPaise ? value / cacPaise : null,
    };
  });
}
