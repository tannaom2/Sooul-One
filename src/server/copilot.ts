import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { decimalToPaise } from "@/lib/format";
import { reportError } from "@/lib/observability";
import { checkCopilotUrl } from "@/lib/copilot-url";
import { KEPT_STATUSES } from "@/lib/intel/customers";
import { riskBand, RISK_BANDS } from "@/lib/intel/rto-risk";
import {
  RULES,
  answerWithRules,
  parseCopilotReport,
  runInsights,
  type CopilotContext,
  type Insight,
  type InsightReport,
} from "@/lib/intel/insights-engine";
import { customerData, loadOrderHistory, paymentReport, pincodeReport, riskQueue } from "@/server/intel-reports";

/**
 * The owner's AI copilot (docs/COPILOT.md): a model running on the owner's
 * own machine (scripts/admin_llm_copilot.py), reached through an ngrok
 * tunnel, with the built-in rules (src/lib/intel/insights-engine.ts) as the
 * fallback whenever it's not configured, offline, slow or answers badly.
 * The admin panel never waits on it for more than a few seconds and never
 * breaks because of it.
 */

/* ------------------------------------------------------------- settings */

export interface CopilotSettings {
  readonly url: string | null;
  readonly token: string | null;
}

export async function getCopilotSettings(): Promise<CopilotSettings> {
  try {
    const row = await db.storeSettings.findUnique({ where: { id: "default" }, select: { copilotUrl: true, copilotToken: true } });
    return { url: row?.copilotUrl ?? null, token: row?.copilotToken ?? null };
  } catch (error) {
    reportError("copilot-settings", error);
    return { url: null, token: null };
  }
}

export function allowedCopilotUrl(url: string): ReturnType<typeof checkCopilotUrl> {
  return checkCopilotUrl(url, {
    // localhost: while developing, or on the local demo (COPILOT_ALLOW_LOCALHOST=1, set by demo:start). Never on Render.
    dev: !process.env.RENDER && (process.env.NODE_ENV !== "production" || process.env.COPILOT_ALLOW_LOCALHOST === "1"),
    // Set to the owner's reserved ngrok domain, only that host is accepted.
    pinnedHosts: (process.env.COPILOT_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
  });
}

/* ------------------------------------------------------------- the call */

type CallResult<T> = { ok: true; data: T } | { ok: false; reason: string };

/**
 * One request to the copilot. Re-checks the address every time (the stored
 * value could predate a rule change), never follows redirects (a tunnel that
 * redirects somewhere else isn't followed there), sends the shared token,
 * and gives up after `timeoutMs`.
 */
async function callCopilot<T>(settings: CopilotSettings, path: "/health" | "/analyze" | "/chat", body: unknown, timeoutMs: number): Promise<CallResult<T>> {
  if (!settings.url || !settings.token) return { ok: false, reason: "not set up" };
  const check = allowedCopilotUrl(settings.url);
  if (!check.ok) return { ok: false, reason: "address not allowed" };
  try {
    const response = await fetch(`${check.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        "Content-Type": "application/json",
        // ngrok's free tier shows a browser warning page unless asked not to.
        "ngrok-skip-browser-warning": "1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "token rejected" };
    if (!response.ok) return { ok: false, reason: `answered ${response.status}` };
    const text = await readCapped(response, 200_000);
    if (text === null) return { ok: false, reason: "answer too large" };
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "answer not understood" };
    return { ok: true, data: data as T };
  } catch (error) {
    const name = (error as { name?: string }).name;
    return { ok: false, reason: name === "TimeoutError" ? "timed out" : "unreachable" };
  }
}

/** The body as text, or null past `max` bytes; stops reading there, so a hostile endpoint can't stream forever. */
async function readCapped(response: Response, max: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export interface CopilotStatus {
  readonly configured: boolean;
  readonly online: boolean;
  readonly model: string | null;
  readonly reason: string | null;
  readonly checkedAt: string;
}

export async function copilotStatus(settings?: CopilotSettings): Promise<CopilotStatus> {
  const s = settings ?? (await getCopilotSettings());
  const checkedAt = new Date().toISOString();
  if (!s.url || !s.token) return { configured: false, online: false, model: null, reason: "Not set up", checkedAt };
  const result = await callCopilot<{ status?: string; model?: string; modelReady?: boolean }>(s, "/health", undefined, 4000);
  if (!result.ok) return { configured: true, online: false, model: null, reason: result.reason, checkedAt };
  const ready = result.data.status === "ok" && result.data.modelReady !== false;
  return {
    configured: true,
    online: ready,
    model: typeof result.data.model === "string" ? result.data.model.slice(0, 80) : null,
    reason: ready ? null : "model not ready",
    checkedAt,
  };
}

/* ------------------------------------------------------------ the context */

const DAY = 24 * 60 * 60 * 1000;

async function buildContext(): Promise<CopilotContext> {
  const now = new Date();
  // One load of the order history for all three reports that need it.
  const history = await loadOrderHistory();
  const [pins, payments, customers, queue, advisories] = await Promise.all([
    pincodeReport(90, "rto", history),
    paymentReport(now),
    customerData(now, history),
    riskQueue(history),
    db.paymentDowntime.findMany({ where: { id: { startsWith: "owner:" }, status: { not: "resolved" } }, select: { method: true } }),
  ]);
  const recent = history.filter((o) => o.placedAt.getTime() >= now.getTime() - 30 * DAY);
  const inRange = (from: number, to: number) => recent.filter((o) => o.placedAt.getTime() >= now.getTime() - from * DAY && o.placedAt.getTime() < now.getTime() - to * DAY);
  const kept = (list: typeof recent) => list.filter((o) => KEPT_STATUSES.has(o.status));
  const sum = (list: typeof recent) => list.reduce((s, o) => s + decimalToPaise(o.totalAmount), 0);
  const last7 = inRange(7, 0);
  const prev7 = inRange(14, 7);

  // Lapsed high-value buyers: top fifth by lifetime value, quiet for 45+ days.
  const buyers = customers.profiles.filter((p) => p.keptOrders > 0).sort((a, b) => b.ltvPaise - a.ltvPaise);
  const threshold = buyers.length ? buyers[Math.max(0, Math.floor(buyers.length * 0.2) - 1)].ltvPaise : 0;
  const lapsed = churnCohort(customers.profiles, now);
  const consent = await consentedPhones(lapsed.map((p) => p.phone).filter((p): p is string => Boolean(p)));

  const segments: Record<string, number> = {};
  for (const r of customers.rfm.values()) segments[r.segment] = (segments[r.segment] ?? 0) + 1;
  const advised = new Set(advisories.map((a) => a.method));

  return {
    generatedAt: now.toISOString(),
    store: {
      ordersLast7: last7.length,
      ordersPrev7: prev7.length,
      revenueLast7Paise: sum(kept(last7)),
      revenuePrev7Paise: sum(kept(prev7)),
      codShare30: recent.length ? recent.filter((o) => o.paymentGateway === "COD").length / recent.length : 0,
      codRtoRate: pins.baseline || null,
    },
    pincodes: pins.rows
      .filter((r) => r.codFinished > 0)
      .slice(0, 15)
      // A city is typed by shoppers: only a plain place name reaches the model.
      .map((r) => ({ pincode: r.pincode, city: r.city && /^[A-Za-z][A-Za-z .'-]{0,39}$/.test(r.city) ? r.city : null, codFinished: r.codFinished, codReturned: r.codReturned, codRtoRate: r.codRtoRate, orders: r.orders, codOffered: r.codOffered })),
    payments: payments.health.map((m) => ({
      method: m.method,
      label: m.label,
      status: m.status,
      recentRate: m.recent.rate,
      baseline: m.baseline,
      attempts: m.recent.attempts,
      advisoryActive: advised.has(m.method),
    })),
    churn: {
      inactiveDays: RULES.churn.inactiveDays,
      count: lapsed.length,
      totalLtvPaise: lapsed.reduce((s, p) => s + p.ltvPaise, 0),
      ltvThresholdPaise: threshold,
      marketingConsent: lapsed.filter((p) => p.phone && consent.has(p.phone)).length,
    },
    segments,
    riskQueue: {
      waiting: queue.length,
      high: queue.filter((o) => riskBand(o.score) === "HIGH").length,
      veryHigh: queue.filter((o) => riskBand(o.score) === "VERY_HIGH").length,
      codValueAtRiskPaise: queue.filter((o) => o.cod && o.score >= RISK_BANDS.high).reduce((s, o) => s + o.totalPaise, 0),
    },
    demand: { outsideChecks: pins.demand.outsideChecks, topRegions: pins.demand.outsideRegions.slice(0, 5) },
  };
}

/** The store's figures for insights and the copilot. Two minutes stale at most: several reports go into it. */
export const getCopilotContext = unstable_cache(buildContext, ["copilot-context"], { revalidate: 120 });

/** High-value buyers (top fifth by lifetime value) with no order for the churn window. */
export function churnCohort<P extends { keptOrders: number; ltvPaise: number; lastOrderAt: Date }>(profiles: readonly P[], now: Date): P[] {
  const buyers = profiles.filter((p) => p.keptOrders > 0).sort((a, b) => b.ltvPaise - a.ltvPaise);
  if (buyers.length === 0) return [];
  const threshold = buyers[Math.max(0, Math.floor(buyers.length * 0.2) - 1)].ltvPaise;
  const cutoff = now.getTime() - RULES.churn.inactiveDays * DAY;
  return buyers.filter((p) => p.ltvPaise >= threshold && new Date(p.lastOrderAt).getTime() < cutoff);
}

/** Numbers with a standing marketing opt-in (latest consent record granted). */
export async function consentedPhones(phones: readonly string[]): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const records = await db.consentRecord.findMany({
    where: { purpose: "MARKETING", phone: { in: [...phones] } },
    orderBy: { createdAt: "asc" },
    select: { phone: true, granted: true },
  });
  const latest = new Map<string, boolean>();
  for (const r of records) if (r.phone) latest.set(r.phone, r.granted);
  return new Set([...latest.entries()].filter(([, granted]) => granted).map(([phone]) => phone));
}

/* ------------------------------------------------------------ the answers */

export interface InsightsResult {
  readonly report: InsightReport;
  /** Why the rules answered instead of the copilot, when it's set up. */
  readonly fallbackReason: string | null;
}

/** Insight cards for the dashboard: the copilot when it's online, else the rules. */
export async function getInsights(): Promise<InsightsResult> {
  const ctx = await getCopilotContext();
  const settings = await getCopilotSettings();
  if (!settings.url || !settings.token) return { report: runInsights(ctx), fallbackReason: null };
  const result = await callCopilot<unknown>(settings, "/analyze", { context: ctx }, 12_000);
  if (result.ok) {
    const report = parseCopilotReport(result.data, ctx);
    if (report) return { report, fallbackReason: null };
    return { report: runInsights(ctx), fallbackReason: "the copilot's answer wasn't in the expected shape" };
  }
  return { report: runInsights(ctx), fallbackReason: `the copilot is ${result.reason}` };
}

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ChatAnswer {
  readonly reply: string;
  readonly insights: readonly Insight[];
  readonly source: "llm" | "rules";
  readonly model: string | null;
  readonly fallbackReason: string | null;
}

export async function askCopilot(message: string, history: readonly ChatTurn[]): Promise<ChatAnswer> {
  const ctx = await getCopilotContext();
  const settings = await getCopilotSettings();
  const rules = (reason: string | null): ChatAnswer => ({ ...answerWithRules(message, ctx), source: "rules", model: null, fallbackReason: reason });
  if (!settings.url || !settings.token) return rules(null);
  const result = await callCopilot<{ reply?: unknown; model?: unknown; insights?: unknown }>(settings, "/chat", { message, history: history.slice(-8), context: ctx }, 45_000);
  if (!result.ok) return rules(`the copilot is ${result.reason}`);
  const reply = typeof result.data.reply === "string" ? result.data.reply.slice(0, 4000) : null;
  if (!reply) return rules("the copilot's answer wasn't in the expected shape");
  const extra = parseCopilotReport({ summary: "", insights: Array.isArray(result.data.insights) ? result.data.insights : [] }, ctx);
  return { reply, insights: extra?.insights ?? [], source: "llm", model: typeof result.data.model === "string" ? result.data.model.slice(0, 80) : null, fallbackReason: null };
}
