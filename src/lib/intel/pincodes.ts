/**
 * Pincode intelligence: how orders to each pincode turn out, and whether
 * checkout offers cash on delivery there. Pure, so it's tested directly; the
 * database reads are in src/server/intel.ts.
 */

export type OrderOutcome = "OPEN" | "DELIVERED" | "RTO" | "RETURNED" | "CANCELLED" | "FAILED" | "REFUNDED";

export interface PincodeOrder {
  readonly pincode: string;
  readonly city: string | null;
  readonly status: string;
  readonly cod: boolean;
  readonly totalPaise: number;
  readonly placedAt: Date;
  readonly deliveredAt: Date | null;
  readonly promisedDeliveryDate: Date | null;
}

export interface PincodeStats {
  readonly pincode: string;
  readonly city: string | null;
  readonly orders: number;
  readonly codOrders: number;
  /** COD share of orders, 0–1. */
  readonly codShare: number;
  readonly delivered: number;
  readonly rto: number;
  readonly returned: number;
  readonly cancelled: number;
  /** Delivered out of parcels whose journey ended (delivered, RTO, returned). Null before any. */
  readonly successRate: number | null;
  /** COD parcels that finished, and how many came back. */
  readonly codFinished: number;
  readonly codReturned: number;
  /** RTO share of finished COD parcels. Null before any. */
  readonly codRtoRate: number | null;
  /** Average days from order to doorstep. Null before any delivery. */
  readonly avgDeliveryDays: number | null;
  /** Delivered by the promised date. Null before any delivery with a promise. */
  readonly onTimeRate: number | null;
  /** Kept revenue: delivered and in-flight orders. */
  readonly revenuePaise: number;
}

const KEPT = new Set(["PAID", "PROCESSING", "SHIPPED", "DELIVERED"]);
const DAY = 24 * 60 * 60 * 1000;

/** End of the promised day in India, so a parcel delivered at 8 pm on the day counts as on time. */
function endOfIstDay(date: Date): number {
  const ist = date.getTime() + 5.5 * 60 * 60 * 1000;
  return Math.floor(ist / DAY) * DAY + DAY - 1 - 5.5 * 60 * 60 * 1000;
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export function pincodeStats(orders: readonly PincodeOrder[]): PincodeStats[] {
  const groups = new Map<string, PincodeOrder[]>();
  for (const o of orders) {
    if (!/^\d{6}$/.test(o.pincode)) continue;
    const list = groups.get(o.pincode) ?? [];
    list.push(o);
    groups.set(o.pincode, list);
  }

  return [...groups.entries()].map(([pincode, list]) => {
    const count = (fn: (o: PincodeOrder) => boolean) => list.filter(fn).length;
    const delivered = count((o) => o.status === "DELIVERED");
    const rto = count((o) => o.status === "RTO");
    const returned = count((o) => o.status === "RETURNED");
    const codOrders = count((o) => o.cod);
    const codReturned = count((o) => o.cod && o.status === "RTO");
    const codFinished = count((o) => o.cod && ["DELIVERED", "RTO", "RETURNED"].includes(o.status));
    const withDelivery = list.filter((o) => o.deliveredAt);
    const withPromise = withDelivery.filter((o) => o.promisedDeliveryDate);
    const days = withDelivery.map((o) => (o.deliveredAt!.getTime() - o.placedAt.getTime()) / DAY);
    return {
      pincode,
      city: list.find((o) => o.city)?.city ?? null,
      orders: list.length,
      codOrders,
      codShare: codOrders / list.length,
      delivered,
      rto,
      returned,
      cancelled: count((o) => o.status === "CANCELLED"),
      successRate: ratio(delivered, delivered + rto + returned),
      codFinished,
      codReturned,
      codRtoRate: ratio(codReturned, codFinished),
      avgDeliveryDays: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null,
      onTimeRate: ratio(withPromise.filter((o) => o.deliveredAt!.getTime() <= endOfIstDay(o.promisedDeliveryDate!)).length, withPromise.length),
      revenuePaise: list.filter((o) => KEPT.has(o.status)).reduce((sum, o) => sum + o.totalPaise, 0),
    };
  });
}

/** The store-wide COD return rate: the baseline pincodes are compared with. */
export function storeCodRtoRate(stats: readonly PincodeStats[]): number {
  const finished = stats.reduce((s, p) => s + p.codFinished, 0);
  const returned = stats.reduce((s, p) => s + p.codReturned, 0);
  return finished > 0 ? returned / finished : 0;
}

export interface PincodeRuleLike {
  readonly codBlocked: boolean;
  readonly codAllowed: boolean;
  readonly extraDays: number;
}

export interface CodSettings {
  readonly codAutoBlock: boolean;
  readonly codAutoBlockRtoPercent: number;
  readonly codAutoBlockMinShipped: number;
  /** ₹, incl. GST. Null: no floor. */
  readonly codMinOrderValue: number | null;
  /** ₹, incl. GST. Null: no cap. */
  readonly codMaxOrderValue: number | null;
}

export type CodRefusal = "PINCODE_BLOCKED" | "AUTO_BLOCKED" | "UNDER_MIN" | "OVER_CAP" | "BUYER_RTO";

/** Earlier parcels to one buyer that came back before COD stops being offered to them. */
export const BUYER_RTO_LIMIT = 2;

/** Would the automatic rule switch COD off for a pincode with this record? */
export function autoBlocks(record: { codFinished: number; codReturned: number } | null, settings: CodSettings): boolean {
  if (!settings.codAutoBlock || !record || record.codFinished < Math.max(1, settings.codAutoBlockMinShipped)) return false;
  return (record.codReturned / record.codFinished) * 100 >= settings.codAutoBlockRtoPercent;
}

/**
 * Whether checkout offers cash on delivery to this pincode, buyer and total.
 * The owner's rule for the pincode wins over the automatic one, in both
 * directions; the order-value limits and a buyer's refusals apply everywhere.
 */
export function codDecision(input: {
  readonly rule: PincodeRuleLike | null;
  readonly record: { codFinished: number; codReturned: number } | null;
  readonly settings: CodSettings;
  readonly totalPaise: number | null;
  /** Earlier parcels to this buyer (account or number) that came back. */
  readonly buyerReturned?: number;
}): { allowed: true } | { allowed: false; reason: CodRefusal } {
  const { rule, record, settings, totalPaise } = input;
  if (rule?.codBlocked) return { allowed: false, reason: "PINCODE_BLOCKED" };
  if (!rule?.codAllowed && autoBlocks(record, settings)) return { allowed: false, reason: "AUTO_BLOCKED" };
  if ((input.buyerReturned ?? 0) >= BUYER_RTO_LIMIT) return { allowed: false, reason: "BUYER_RTO" };
  if (settings.codMinOrderValue != null && totalPaise != null && totalPaise < settings.codMinOrderValue * 100) {
    return { allowed: false, reason: "UNDER_MIN" };
  }
  if (settings.codMaxOrderValue != null && totalPaise != null && totalPaise > settings.codMaxOrderValue * 100) {
    return { allowed: false, reason: "OVER_CAP" };
  }
  return { allowed: true };
}

const rupees = (n: number) => "₹" + n.toLocaleString("en-IN");

/** What the shopper is told when cash on delivery isn't offered. Never blames the area or the person. */
export function codRefusalMessage(reason: CodRefusal, settings: Pick<CodSettings, "codMinOrderValue" | "codMaxOrderValue">): string {
  if (reason === "OVER_CAP" && settings.codMaxOrderValue != null) {
    return "Cash on delivery is available on orders up to " + rupees(settings.codMaxOrderValue) + ". Pay online to place this one.";
  }
  if (reason === "UNDER_MIN" && settings.codMinOrderValue != null) {
    return "Cash on delivery is available on orders of " + rupees(settings.codMinOrderValue) + " or more. Pay online, or add a little more.";
  }
  if (reason === "BUYER_RTO") return "Cash on delivery isn't available for this order. Pay online with UPI or card instead.";
  return "Cash on delivery isn't available for this pincode. Pay online with UPI or card instead.";
}

/** A day's worth of pincodes typed at checkout, split by whether we deliver there. */
export interface PincodeDemand {
  readonly pincode: string;
  readonly checks: number;
  readonly serviceable: boolean;
}

export function demandByPincode(events: readonly { pincode: string; serviceable: boolean }[]): PincodeDemand[] {
  const map = new Map<string, PincodeDemand>();
  for (const e of events) {
    if (!/^\d{6}$/.test(e.pincode)) continue;
    const prev = map.get(e.pincode);
    map.set(e.pincode, { pincode: e.pincode, checks: (prev?.checks ?? 0) + 1, serviceable: e.serviceable });
  }
  return [...map.values()].sort((a, b) => b.checks - a.checks || a.pincode.localeCompare(b.pincode));
}

/** Postal region from the first two digits: where outside demand comes from. */
export const POSTAL_REGIONS: Record<string, string> = {
  "11": "Delhi", "12": "Haryana", "13": "Haryana", "14": "Punjab", "15": "Punjab", "16": "Chandigarh / Punjab",
  "17": "Himachal Pradesh", "18": "Jammu & Kashmir", "19": "Jammu & Kashmir", "20": "Uttar Pradesh", "21": "Uttar Pradesh",
  "22": "Uttar Pradesh", "23": "Uttar Pradesh", "24": "Uttarakhand / UP", "25": "Uttar Pradesh", "26": "Uttarakhand / UP",
  "27": "Uttar Pradesh", "28": "Uttar Pradesh", "30": "Rajasthan", "31": "Rajasthan", "32": "Rajasthan", "33": "Rajasthan",
  "34": "Rajasthan", "36": "Gujarat", "37": "Gujarat", "38": "Gujarat", "39": "Gujarat", "40": "Maharashtra (Mumbai)",
  "41": "Maharashtra", "42": "Maharashtra", "43": "Maharashtra", "44": "Maharashtra", "45": "Madhya Pradesh",
  "46": "Madhya Pradesh", "47": "Madhya Pradesh", "48": "Madhya Pradesh", "49": "Chhattisgarh", "50": "Telangana",
  "51": "Andhra Pradesh", "52": "Andhra Pradesh", "53": "Andhra Pradesh", "56": "Karnataka (Bengaluru)", "57": "Karnataka",
  "58": "Karnataka", "59": "Karnataka", "60": "Tamil Nadu (Chennai)", "61": "Tamil Nadu", "62": "Tamil Nadu", "63": "Tamil Nadu",
  "64": "Tamil Nadu", "67": "Kerala", "68": "Kerala", "69": "Kerala", "70": "West Bengal (Kolkata)", "71": "West Bengal",
  "72": "West Bengal", "73": "West Bengal", "74": "West Bengal", "75": "Odisha", "76": "Odisha", "77": "Odisha",
  "78": "Assam", "79": "North East", "80": "Bihar", "81": "Bihar", "82": "Jharkhand", "83": "Jharkhand", "84": "Bihar", "85": "Bihar",
};

export function postalRegion(pincode: string): string {
  return POSTAL_REGIONS[pincode.slice(0, 2)] ?? "Other";
}
