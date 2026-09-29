/**
 * Payment health per method: is UPI, card or net banking succeeding as
 * often as usual? Pure, so it's tested directly (tests/intel.test.ts).
 *
 * At tens of orders a day a percentage on a small window mostly measures
 * noise (7 captured out of 10 is not evidence of anything), so the rules are
 * layered, following docs/INTELLIGENCE.md:
 *
 *   1. Tripwire: the last three gateway-side attempts on a method all failed,
 *      from at least two different orders, within 30 minutes. One shopper
 *      retrying can't trip it; at a 12% failure rate three in a row happens
 *      by chance about 0.2% of the time.
 *   2. Statistics: the Wilson 95% interval of the recent success rate. Only
 *      when even its upper bound sits below the baseline is the method
 *      flagged: 5 pp below is degraded, 25 pp below is down. Needs 10 attempts.
 *   3. Baseline: the method's own last 28 days when there are 100 attempts to
 *      go on, otherwise the published norm for that method.
 *
 * Failures the shopper caused (a cancelled UPI request, a wrong OTP, too
 * little balance) are left out of the gateway rate, so abandonment can't look
 * like an outage; they still count in the attempt rate, which is a checkout
 * experience number.
 */

export interface AttemptLike {
  readonly orderId: string | null;
  readonly method: string | null;
  readonly status: string; // CAPTURED | FAILED
  readonly createdAt: Date;
  readonly errorSource: string | null;
  readonly errorReason: string | null;
}

export type HealthStatus = "OK" | "DEGRADED" | "DOWN" | "LOW_DATA";

export interface WindowRate {
  readonly attempts: number;
  readonly captured: number;
  /** 0–1, or null with no attempts. */
  readonly rate: number | null;
}

export interface MethodHealth {
  readonly method: string;
  readonly label: string;
  /** Gateway-side success in the recent window (shopper-caused failures left out). */
  readonly recent: WindowRate;
  /** Wilson 95% interval of `recent.rate`. */
  readonly interval: { readonly low: number; readonly high: number } | null;
  /** Every attempt in the recent window, shopper-caused failures included. */
  readonly attemptRate: WindowRate;
  readonly baseline: number;
  readonly baselineFrom: "history" | "norm";
  readonly status: HealthStatus;
  readonly why: string;
  readonly topErrors: readonly { reason: string; count: number; customer: boolean }[];
  /** Gateway success per day, oldest first (null on days with no attempts). */
  readonly daily: readonly (number | null)[];
}

export const MIN_SAMPLE = 10;
export const MIN_BASELINE = 100;
/** Recent window: the last 24 hours, or the last 30 attempts if that's more. */
export const RECENT = { hours: 24, attempts: 30 } as const;
export const BASELINE_DAYS = 28;
/** Upper bound this far below baseline: degraded, and down. */
export const MARGIN = { degraded: 0.05, down: 0.25 } as const;

/** Typical success rates by method (Razorpay's published benchmarks), used until there's history. */
export const METHOD_NORM: Record<string, number> = { upi: 0.9, card: 0.85, netbanking: 0.8, wallet: 0.85, emi: 0.8, paylater: 0.8 };

export const METHOD_LABEL: Record<string, string> = {
  upi: "UPI",
  card: "Card",
  netbanking: "Net banking",
  wallet: "Wallet",
  emi: "EMI",
  paylater: "Pay later (BNPL)",
  unknown: "Not recorded",
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const CUSTOMER_REASON = /cancel|timed out|timeout|expired|insufficient|wrong otp|invalid otp|incorrect otp|incorrect pin|declined by (the )?customer|not approved/i;

/** Did the shopper cause this failure, rather than the bank or gateway? */
export function customerCaused(a: Pick<AttemptLike, "status" | "errorSource" | "errorReason">): boolean {
  if (a.status !== "FAILED") return false;
  if (a.errorSource) return a.errorSource.toLowerCase() === "customer";
  return CUSTOMER_REASON.test(a.errorReason ?? "");
}

/** Wilson score interval for `captured` out of `n` (95% by default). */
export function wilson(captured: number, n: number, z = 1.96): { low: number; high: number } | null {
  if (n === 0) return null;
  const p = captured / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

function rateOf(list: readonly AttemptLike[]): WindowRate {
  const captured = list.filter((a) => a.status === "CAPTURED").length;
  return { attempts: list.length, captured, rate: list.length ? captured / list.length : null };
}

/** The last three gateway attempts failed, from two or more orders, within 30 minutes. */
export function tripwire(gatewayNewestFirst: readonly AttemptLike[]): boolean {
  const last = gatewayNewestFirst.slice(0, 3);
  if (last.length < 3 || last.some((a) => a.status !== "FAILED")) return false;
  const orders = new Set(last.map((a) => a.orderId ?? `${a.createdAt.getTime()}`));
  return orders.size >= 2 && last[0].createdAt.getTime() - last[2].createdAt.getTime() <= 30 * MINUTE;
}

export function judge(recent: WindowRate, baseline: number, tripped: boolean): { status: HealthStatus; why: string; interval: { low: number; high: number } | null } {
  const interval = wilson(recent.captured, recent.attempts);
  if (tripped) return { status: "DOWN", why: "The last 3 attempts failed, from different orders, within 30 minutes.", interval };
  if (recent.attempts < MIN_SAMPLE || !interval) return { status: "LOW_DATA", why: `Fewer than ${MIN_SAMPLE} attempts recently: too few to judge.`, interval };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (interval.high < baseline - MARGIN.down) return { status: "DOWN", why: `Even at best ${pct(interval.high)}, far below the usual ${pct(baseline)}.`, interval };
  if (interval.high < baseline - MARGIN.degraded) return { status: "DEGRADED", why: `At best ${pct(interval.high)}, below the usual ${pct(baseline)}.`, interval };
  return { status: "OK", why: `Within the normal range of the usual ${pct(baseline)}.`, interval };
}

export function paymentHealth(attempts: readonly AttemptLike[], now: Date): MethodHealth[] {
  const byMethod = new Map<string, AttemptLike[]>();
  for (const a of attempts) {
    if (a.createdAt.getTime() > now.getTime()) continue;
    const key = (a.method ?? "unknown").toLowerCase();
    (byMethod.get(key) ?? byMethod.set(key, []).get(key)!).push(a);
  }

  return [...byMethod.entries()]
    .map(([method, all]) => {
      const newest = [...all].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const gateway = newest.filter((a) => !customerCaused(a));
      const since = now.getTime() - RECENT.hours * HOUR;
      const byTime = gateway.filter((a) => a.createdAt.getTime() >= since);
      const recentList = byTime.length >= RECENT.attempts ? byTime : gateway.slice(0, Math.max(byTime.length, RECENT.attempts));
      const recentStart = recentList.length ? recentList[recentList.length - 1].createdAt.getTime() : since;
      const baselineList = gateway.filter((a) => a.createdAt.getTime() < recentStart && a.createdAt.getTime() >= recentStart - BASELINE_DAYS * DAY);
      const history = rateOf(baselineList);
      const useHistory = history.attempts >= MIN_BASELINE && history.rate !== null;
      const baseline = useHistory ? history.rate! : (METHOD_NORM[method] ?? 0.85);
      const recent = rateOf(recentList);
      const verdict = judge(recent, baseline, tripwire(gateway));

      const errors = new Map<string, { count: number; customer: boolean }>();
      for (const a of newest.filter((x) => x.createdAt.getTime() >= since && x.status === "FAILED")) {
        const reason = a.errorReason?.trim() || "No reason given";
        const e = errors.get(reason) ?? { count: 0, customer: customerCaused(a) };
        e.count += 1;
        errors.set(reason, e);
      }
      const days = 8;
      const daily = Array.from({ length: days }, (_, i) => {
        const from = now.getTime() - (days - i) * DAY;
        return rateOf(gateway.filter((a) => a.createdAt.getTime() >= from && a.createdAt.getTime() < from + DAY)).rate;
      });
      return {
        method,
        label: METHOD_LABEL[method] ?? method,
        recent,
        interval: verdict.interval,
        attemptRate: rateOf(newest.filter((a) => a.createdAt.getTime() >= since)),
        baseline,
        baselineFrom: useHistory ? ("history" as const) : ("norm" as const),
        status: verdict.status,
        why: verdict.why,
        topErrors: [...errors.entries()].map(([reason, e]) => ({ reason, ...e })).sort((a, b) => b.count - a.count).slice(0, 4),
        daily,
      };
    })
    .sort((a, b) => b.recent.attempts - a.recent.attempts || a.method.localeCompare(b.method));
}

/** The worst status across methods with enough data: the headline for the page. */
export function overallStatus(methods: readonly MethodHealth[]): HealthStatus {
  const order: HealthStatus[] = ["DOWN", "DEGRADED", "OK", "LOW_DATA"];
  return order.find((s) => methods.some((m) => m.status === s)) ?? "LOW_DATA";
}
