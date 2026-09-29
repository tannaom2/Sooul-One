/**
 * Insights for the owner console, from rules (no AI model, no cost). Also the
 * shared shapes the local AI copilot must answer in (scripts/admin_llm_copilot.py),
 * so the dashboard cards and the Copilot drawer render the same whichever
 * produced them. Pure, so every rule is unit-tested (tests/insights.test.ts).
 *
 * The context holds store-level figures only: pincodes, rates, counts and
 * totals. No names, phone numbers, emails or addresses, since it's what gets
 * sent to the copilot on the owner's own machine.
 */

import { z } from "zod";

/* --------------------------------------------------------------- shapes */

export type InsightKind = "RTO_SPIKE" | "PAYMENT_FRICTION" | "CHURN_RISK" | "RISK_QUEUE" | "SALES_TREND" | "DEMAND_GAP" | "INFO";
export type Severity = "critical" | "warning" | "info";

export type InsightAction =
  | { readonly type: "DISABLE_COD"; readonly pincode: string }
  | { readonly type: "PRIORITIZE_BACKUP_METHOD"; readonly method: string }
  | { readonly type: "CLEAR_ADVISORY"; readonly method: string }
  | { readonly type: "EXPORT_COHORT"; readonly cohort: "churn-high-ltv" }
  | { readonly type: "OPEN"; readonly href: string; readonly label: string };

export interface Insight {
  readonly id: string;
  readonly kind: InsightKind;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  readonly metric?: string;
  readonly action?: InsightAction;
}

export interface InsightReport {
  readonly source: "rules" | "llm";
  readonly model?: string;
  readonly generatedAt: string;
  readonly summary: string;
  readonly insights: readonly Insight[];
}

export interface CopilotContext {
  readonly generatedAt: string;
  readonly store: {
    readonly ordersLast7: number;
    readonly ordersPrev7: number;
    readonly revenueLast7Paise: number;
    readonly revenuePrev7Paise: number;
    /** COD share of orders, last 30 days, 0–1. */
    readonly codShare30: number;
    /** Store-wide COD return-to-origin rate, all time, 0–1 (null before any). */
    readonly codRtoRate: number | null;
  };
  /** Pincodes with finished COD parcels, worst first. */
  readonly pincodes: readonly {
    readonly pincode: string;
    readonly city: string | null;
    readonly codFinished: number;
    readonly codReturned: number;
    readonly codRtoRate: number | null;
    readonly orders: number;
    readonly codOffered: boolean;
  }[];
  readonly payments: readonly {
    readonly method: string;
    readonly label: string;
    readonly status: "OK" | "DEGRADED" | "DOWN" | "LOW_DATA";
    readonly recentRate: number | null;
    readonly baseline: number;
    readonly attempts: number;
    /** The owner is already steering shoppers away from it. */
    readonly advisoryActive: boolean;
  }[];
  readonly churn: {
    readonly inactiveDays: number;
    /** High-value buyers (top fifth by lifetime value) with no order for inactiveDays. */
    readonly count: number;
    readonly totalLtvPaise: number;
    readonly ltvThresholdPaise: number;
    readonly marketingConsent: number;
  };
  readonly segments: Readonly<Record<string, number>>;
  readonly riskQueue: { readonly waiting: number; readonly high: number; readonly veryHigh: number; readonly codValueAtRiskPaise: number };
  readonly demand: { readonly outsideChecks: number; readonly topRegions: readonly { readonly region: string; readonly checks: number }[] };
}

/* ------------------------------------------------- validation (for the LLM) */

const PINCODE = /^\d{6}$/;
const METHOD = /^[a-z]{2,20}$/;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("DISABLE_COD"), pincode: z.string().regex(PINCODE) }),
  z.object({ type: z.literal("PRIORITIZE_BACKUP_METHOD"), method: z.string().regex(METHOD) }),
  z.object({ type: z.literal("CLEAR_ADVISORY"), method: z.string().regex(METHOD) }),
  z.object({ type: z.literal("EXPORT_COHORT"), cohort: z.literal("churn-high-ltv") }),
  // Only console pages: a model mustn't be able to put an outside link on a card.
  z.object({ type: z.literal("OPEN"), href: z.string().regex(/^\/admin(\/[a-z0-9/?=&-]*)?$/), label: z.string().max(40) }),
]);

const insightSchema = z.object({
  id: z.string().max(80),
  kind: z.enum(["RTO_SPIKE", "PAYMENT_FRICTION", "CHURN_RISK", "RISK_QUEUE", "SALES_TREND", "DEMAND_GAP", "INFO"]),
  severity: z.enum(["critical", "warning", "info"]),
  title: z.string().min(1).max(140),
  detail: z.string().max(600),
  metric: z.string().max(60).optional(),
  action: actionSchema.optional(),
});

const reportSchema = z.object({
  summary: z.string().max(1200),
  insights: z.array(z.unknown()).max(20),
  model: z.string().max(80).optional(),
});

/**
 * Whether the figures back an action, whoever suggested it. A model can be
 * steered by text inside the data (a city typed at checkout), so its cards
 * only keep buttons the same rules would offer: COD off only for a pincode
 * that's refusing parcels and still offers COD, a payment note only for a
 * method that's actually struggling, and so on.
 */
export function actionSupported(a: InsightAction, ctx: CopilotContext): boolean {
  const storeRate = ctx.store.codRtoRate ?? 0;
  switch (a.type) {
    case "DISABLE_COD": {
      const p = ctx.pincodes.find((x) => x.pincode === a.pincode);
      return Boolean(
        p && p.codOffered && p.codRtoRate !== null && p.codFinished >= RULES.rto.minFinished && p.codReturned >= RULES.rto.minReturned &&
          p.codRtoRate >= Math.max(RULES.rto.floorRate, storeRate * RULES.rto.overStore),
      );
    }
    case "PRIORITIZE_BACKUP_METHOD":
      return ctx.payments.some((m) => m.method === a.method && (m.status === "DEGRADED" || m.status === "DOWN") && !m.advisoryActive);
    case "CLEAR_ADVISORY":
      return ctx.payments.some((m) => m.method === a.method && m.advisoryActive);
    case "EXPORT_COHORT":
      return ctx.churn.count > 0;
    case "OPEN":
      return true;
  }
}

/**
 * Accept a copilot's answer only in the agreed shape. Anything a model made
 * up is dropped, insight by insight, and a button is kept only when the
 * figures back it (actionSupported).
 */
export function parseCopilotReport(raw: unknown, ctx: CopilotContext): InsightReport | null {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return null;
  const insights: Insight[] = [];
  for (const item of parsed.data.insights) {
    const ok = insightSchema.safeParse(item);
    if (!ok.success) continue;
    let insight: Insight = ok.data;
    if (insight.action && !actionSupported(insight.action, ctx)) insight = { ...insight, action: undefined };
    insights.push(insight);
  }
  return { source: "llm", model: parsed.data.model, generatedAt: new Date().toISOString(), summary: parsed.data.summary, insights };
}

/* ------------------------------------------------------------ the rules */

const pct = (v: number) => `${Math.round(v * 100)}%`;
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** Thresholds, exported so the tests and docs/COPILOT.md name the same numbers. */
export const RULES = {
  rto: { minFinished: 3, minReturned: 2, floorRate: 0.25, criticalRate: 0.4, overStore: 2 },
  churn: { inactiveDays: 45 },
  sales: { minPrev: 10, drop: 0.3 },
  demand: { minOutside: 20 },
} as const;

export function runInsights(ctx: CopilotContext): InsightReport {
  const insights: Insight[] = [];
  const storeRate = ctx.store.codRtoRate ?? 0;

  // RTO spikes: pincodes returning far more COD parcels than the store does.
  for (const p of ctx.pincodes) {
    if (p.codRtoRate === null || p.codFinished < RULES.rto.minFinished || p.codReturned < RULES.rto.minReturned) continue;
    if (p.codRtoRate < Math.max(RULES.rto.floorRate, storeRate * RULES.rto.overStore)) continue;
    insights.push({
      id: `rto-${p.pincode}`,
      kind: "RTO_SPIKE",
      severity: p.codRtoRate >= RULES.rto.criticalRate ? "critical" : "warning",
      title: `${p.pincode}${p.city ? ` (${p.city})` : ""} returns ${pct(p.codRtoRate)} of COD parcels`,
      detail: p.codOffered
        ? `${p.codReturned} of ${p.codFinished} cash on delivery parcels came back, against ${pct(storeRate)} store-wide. Each one costs the courier fee both ways.`
        : `${p.codReturned} of ${p.codFinished} came back. Cash on delivery is already off here.`,
      metric: `${p.codReturned}/${p.codFinished}`,
      action: p.codOffered ? { type: "DISABLE_COD", pincode: p.pincode } : undefined,
    });
  }

  // Payment friction: a method succeeding well below its usual rate.
  for (const m of ctx.payments) {
    if (m.status !== "DEGRADED" && m.status !== "DOWN") {
      if (m.advisoryActive) {
        insights.push({
          id: `advisory-${m.method}`,
          kind: "PAYMENT_FRICTION",
          severity: "info",
          title: `Shoppers are being steered away from ${m.label}`,
          detail: `${m.label} looks normal again (${m.recentRate === null ? "no recent attempts" : pct(m.recentRate)} recently). Clear the note when you're happy.`,
          action: { type: "CLEAR_ADVISORY", method: m.method },
        });
      }
      continue;
    }
    insights.push({
      id: `pay-${m.method}`,
      kind: "PAYMENT_FRICTION",
      severity: m.status === "DOWN" ? "critical" : "warning",
      title: `${m.label} payments are ${m.status === "DOWN" ? "failing" : "struggling"}`,
      detail: `${m.recentRate === null ? "No" : pct(m.recentRate)} success recently, against a usual ${pct(m.baseline)}, over ${m.attempts} attempts.${m.advisoryActive ? " Shoppers are already being steered to another method." : " Checkout can suggest another way to pay until it recovers."}`,
      metric: m.recentRate === null ? undefined : pct(m.recentRate),
      action: m.advisoryActive ? { type: "CLEAR_ADVISORY", method: m.method } : { type: "PRIORITIZE_BACKUP_METHOD", method: m.method },
    });
  }

  // Churn: valuable buyers who've gone quiet.
  if (ctx.churn.count > 0) {
    insights.push({
      id: "churn-high-ltv",
      kind: "CHURN_RISK",
      severity: ctx.churn.count >= 10 ? "warning" : "info",
      title: `${ctx.churn.count} high-value buyer${ctx.churn.count === 1 ? " hasn't" : "s haven't"} ordered in ${ctx.churn.inactiveDays}+ days`,
      detail: `Together worth ${rupees(ctx.churn.totalLtvPaise)} so far (each over ${rupees(ctx.churn.ltvThresholdPaise)}). ${ctx.churn.marketingConsent} agreed to offers; message only them.`,
      metric: String(ctx.churn.count),
      action: { type: "EXPORT_COHORT", cohort: "churn-high-ltv" },
    });
  }

  // Dispatch: risky orders waiting.
  if (ctx.riskQueue.high + ctx.riskQueue.veryHigh > 0) {
    const n = ctx.riskQueue.high + ctx.riskQueue.veryHigh;
    insights.push({
      id: "risk-queue",
      kind: "RISK_QUEUE",
      severity: ctx.riskQueue.veryHigh > 0 ? "warning" : "info",
      title: `${n} order${n === 1 ? "" : "s"} to confirm before packing`,
      detail: `${ctx.riskQueue.veryHigh} very high and ${ctx.riskQueue.high} high RTO risk, ${rupees(ctx.riskQueue.codValueAtRiskPaise)} of cash on delivery.`,
      metric: String(n),
      action: { type: "OPEN", href: "/admin/analytics/risk", label: "Open RTO risk" },
    });
  }

  // Sales: a sharp week-on-week drop.
  const { ordersLast7: now, ordersPrev7: before } = ctx.store;
  if (before >= RULES.sales.minPrev && now < before * (1 - RULES.sales.drop)) {
    insights.push({
      id: "sales-drop",
      kind: "SALES_TREND",
      severity: "warning",
      title: `Orders down ${pct(1 - now / before)} on last week`,
      detail: `${now} orders in the last 7 days against ${before} the week before (${rupees(ctx.store.revenueLast7Paise)} vs ${rupees(ctx.store.revenuePrev7Paise)}). Check stock, payments and the funnel.`,
      action: { type: "OPEN", href: "/admin/funnel", label: "Open funnel" },
    });
  }

  // Demand from outside the delivery area.
  if (ctx.demand.outsideChecks >= RULES.demand.minOutside && ctx.demand.topRegions.length) {
    const top = ctx.demand.topRegions[0];
    insights.push({
      id: "demand-gap",
      kind: "DEMAND_GAP",
      severity: "info",
      title: `${ctx.demand.outsideChecks} pincode checks from outside Gujarat`,
      detail: `Most from ${top.region} (${top.checks}). A guide to where to deliver next.`,
      action: { type: "OPEN", href: "/admin/analytics/pincodes", label: "Open pincodes" },
    });
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  insights.sort((a, b) => order[a.severity] - order[b.severity]);
  const urgent = insights.filter((i) => i.severity !== "info").length;
  const summary =
    insights.length === 0
      ? `Nothing needs attention. ${now} orders in the last 7 days.`
      : `${urgent ? `${urgent} thing${urgent === 1 ? "" : "s"} need${urgent === 1 ? "s" : ""} attention` : "Nothing urgent"}. ${now} orders in the last 7 days${before ? ` (${now >= before ? "up" : "down"} from ${before})` : ""}.`;
  return { source: "rules", generatedAt: ctx.generatedAt, summary, insights };
}

/* ------------------------------------------------- chat without a model */

export type ChatTopic = "rto" | "payments" | "churn" | "offer" | "sales" | "risk" | "demand" | "help";

export function chatTopic(message: string): ChatTopic {
  const m = message.toLowerCase();
  if (/\b(offer|draft|message|campaign|re-?engage|win ?back|coupon)\b/.test(m)) return "offer";
  if (/\b(rto|return(ed)? to origin|refus|pincode|pin code|cod)\b/.test(m)) return "rto";
  if (/\b(payment|gateway|upi|card|net ?banking|razorpay|fail)/.test(m)) return "payments";
  if (/\b(churn|inactive|lapsed|dormant|quiet|lost|sleep)/.test(m)) return "churn";
  if (/\b(risk|dispatch|pack|confirm|queue)\b/.test(m)) return "risk";
  if (/\b(sales|revenue|orders?|week|trend)\b/.test(m)) return "sales";
  if (/\b(demand|expand|outside|region|where next)\b/.test(m)) return "demand";
  return "help";
}

/**
 * Answer a console question from the same rules, for when the local copilot
 * is off. Honest about what it is: it matches topics, it doesn't reason.
 */
export function answerWithRules(message: string, ctx: CopilotContext): { reply: string; insights: Insight[] } {
  const report = runInsights(ctx);
  const topic = chatTopic(message);
  const of = (kind: InsightKind) => report.insights.filter((i) => i.kind === kind);
  switch (topic) {
    case "rto": {
      const spikes = of("RTO_SPIKE");
      const worst = ctx.pincodes.filter((p) => p.codRtoRate !== null && p.codReturned > 0).slice(0, 5);
      const list = worst.map((p) => `${p.pincode}${p.city ? ` ${p.city}` : ""}: ${pct(p.codRtoRate ?? 0)} (${p.codReturned}/${p.codFinished})`).join("; ");
      return {
        reply: spikes.length
          ? `${spikes.length} pincode${spikes.length === 1 ? " stands" : "s stand"} out for returned COD parcels. Worst: ${list}. Store-wide it's ${pct(storeRateOf(ctx))}.`
          : `No pincode stands out yet. Store-wide COD returns are ${pct(storeRateOf(ctx))}.${list ? ` Highest so far: ${list}.` : ""}`,
        insights: spikes,
      };
    }
    case "payments": {
      const issues = of("PAYMENT_FRICTION");
      const lines = ctx.payments.map((p) => `${p.label} ${p.status === "LOW_DATA" ? "too few attempts to judge" : `${p.status.toLowerCase()} (${p.recentRate === null ? "—" : pct(p.recentRate)} vs usual ${pct(p.baseline)})`}`);
      return { reply: `${issues.length ? "There's payment trouble. " : "Payments look normal. "}${lines.join("; ") || "No online payment attempts recorded."}.`, insights: issues };
    }
    case "churn":
      return {
        reply: ctx.churn.count
          ? `${ctx.churn.count} high-value buyers haven't ordered in ${ctx.churn.inactiveDays}+ days, worth ${rupees(ctx.churn.totalLtvPaise)} so far. ${ctx.churn.marketingConsent} of them agreed to offers. Export the list to reach them.`
          : `No high-value buyer has gone quiet for ${ctx.churn.inactiveDays}+ days.`,
        insights: of("CHURN_RISK"),
      };
    case "offer": {
      const n = ctx.churn.marketingConsent;
      return {
        reply: [
          `Draft for the ${n} lapsed high-value buyer${n === 1 ? "" : "s"} who agreed to offers (edit before sending):`,
          "",
          "\"Hi {first name}, it's been a while! Your favourites are back in stock, and here's 10% off your next order with code COMEBACK10, valid for 7 days. Free delivery over ₹799 across Gujarat. Reply STOP to opt out.\"",
          "",
          "Create the code in Discount codes first (one use per customer, 7-day expiry), and send only to people who agreed to offers.",
        ].join("\n"),
        insights: of("CHURN_RISK"),
      };
    }
    case "risk":
      return {
        reply: `${ctx.riskQueue.waiting} orders are waiting to ship: ${ctx.riskQueue.veryHigh} very high risk, ${ctx.riskQueue.high} high. ${rupees(ctx.riskQueue.codValueAtRiskPaise)} of cash on delivery is at high risk.`,
        insights: of("RISK_QUEUE"),
      };
    case "sales":
      return {
        reply: `${ctx.store.ordersLast7} orders and ${rupees(ctx.store.revenueLast7Paise)} in the last 7 days, against ${ctx.store.ordersPrev7} and ${rupees(ctx.store.revenuePrev7Paise)} the week before. Cash on delivery is ${pct(ctx.store.codShare30)} of orders.`,
        insights: of("SALES_TREND"),
      };
    case "demand":
      return {
        reply: ctx.demand.topRegions.length
          ? `${ctx.demand.outsideChecks} pincode checks came from outside the delivery area. Top: ${ctx.demand.topRegions.slice(0, 4).map((r) => `${r.region} (${r.checks})`).join(", ")}.`
          : "No pincode checks from outside the delivery area yet.",
        insights: of("DEMAND_GAP"),
      };
    default:
      return {
        reply: `${report.summary} Ask about RTO by pincode, payment health, lapsed buyers, a win-back message, orders to confirm, sales this week or demand from outside Gujarat.`,
        insights: report.insights.slice(0, 3),
      };
  }
}

function storeRateOf(ctx: CopilotContext): number {
  return ctx.store.codRtoRate ?? 0;
}
