import { describe, expect, it } from "vitest";
import { answerWithRules, chatTopic, parseCopilotReport, runInsights, RULES, type CopilotContext } from "@/lib/intel/insights-engine";
import { checkCopilotUrl, maskToken } from "@/lib/copilot-url";

/**
 * The built-in insights engine and the rules for the owner's local copilot
 * (docs/COPILOT.md): cards look the same whichever produced them, and a
 * model's answer is only accepted in the agreed shape.
 */

const base: CopilotContext = {
  generatedAt: "2026-09-29T06:30:00.000Z",
  store: { ordersLast7: 30, ordersPrev7: 32, revenueLast7Paise: 30_000_00, revenuePrev7Paise: 31_000_00, codShare30: 0.5, codRtoRate: 0.05 },
  pincodes: [],
  payments: [],
  churn: { inactiveDays: 45, count: 0, totalLtvPaise: 0, ltvThresholdPaise: 1500_00, marketingConsent: 0 },
  segments: {},
  riskQueue: { waiting: 3, high: 0, veryHigh: 0, codValueAtRiskPaise: 0 },
  demand: { outsideChecks: 0, topRegions: [] },
};
const ctx = (over: Partial<CopilotContext>): CopilotContext => ({ ...base, ...over });
const pin = (pincode: string, codFinished: number, codReturned: number, codOffered = true) => ({
  pincode, city: "Surat", codFinished, codReturned, codRtoRate: codFinished ? codReturned / codFinished : null, orders: codFinished, codOffered,
});

describe("insights from rules", () => {
  it("says nothing needs attention on a quiet week", () => {
    const r = runInsights(base);
    expect(r.source).toBe("rules");
    expect(r.insights).toEqual([]);
    expect(r.summary).toMatch(/Nothing needs attention/);
  });

  it("flags a pincode returning far more COD parcels than the store, with a Disable COD action", () => {
    const r = runInsights(ctx({ pincodes: [pin("395007", 10, 5), pin("380015", 20, 1)] }));
    expect(r.insights).toHaveLength(1);
    expect(r.insights[0]).toMatchObject({ id: "rto-395007", kind: "RTO_SPIKE", severity: "critical", action: { type: "DISABLE_COD", pincode: "395007" } });
  });

  it("needs enough parcels and refusals, and offers no action once COD is already off", () => {
    expect(runInsights(ctx({ pincodes: [pin("395007", 2, 2)] })).insights).toHaveLength(0); // too few parcels
    expect(runInsights(ctx({ pincodes: [pin("395007", 20, 1)] })).insights).toHaveLength(0); // one refusal
    const off = runInsights(ctx({ pincodes: [pin("395007", 10, 4, false)] })).insights[0];
    expect(off.severity).toBe("critical");
    expect(off.action).toBeUndefined();
  });

  it("flags a struggling payment method with Prioritize backup, and offers to clear a note once it recovers", () => {
    const degraded = runInsights(ctx({ payments: [{ method: "card", label: "Card", status: "DEGRADED", recentRate: 0.6, baseline: 0.85, attempts: 30, advisoryActive: false }] }));
    expect(degraded.insights[0]).toMatchObject({ kind: "PAYMENT_FRICTION", severity: "warning", action: { type: "PRIORITIZE_BACKUP_METHOD", method: "card" } });
    const recovered = runInsights(ctx({ payments: [{ method: "card", label: "Card", status: "OK", recentRate: 0.9, baseline: 0.85, attempts: 30, advisoryActive: true }] }));
    expect(recovered.insights[0]).toMatchObject({ severity: "info", action: { type: "CLEAR_ADVISORY", method: "card" } });
    expect(runInsights(ctx({ payments: [{ method: "upi", label: "UPI", status: "LOW_DATA", recentRate: null, baseline: 0.9, attempts: 2, advisoryActive: false }] })).insights).toHaveLength(0);
  });

  it("flags lapsed high-value buyers with Export cohort, mentioning consent", () => {
    const r = runInsights(ctx({ churn: { inactiveDays: 45, count: 12, totalLtvPaise: 60_000_00, ltvThresholdPaise: 2500_00, marketingConsent: 4 } }));
    expect(r.insights[0]).toMatchObject({ kind: "CHURN_RISK", severity: "warning", action: { type: "EXPORT_COHORT", cohort: "churn-high-ltv" } });
    expect(r.insights[0].detail).toMatch(/4 agreed to offers/);
    expect(RULES.churn.inactiveDays).toBe(45);
  });

  it("points at the risk queue, a sales drop and outside demand, most urgent first", () => {
    const r = runInsights(
      ctx({
        store: { ...base.store, ordersLast7: 10, ordersPrev7: 30 },
        riskQueue: { waiting: 5, high: 1, veryHigh: 1, codValueAtRiskPaise: 2000_00 },
        demand: { outsideChecks: 40, topRegions: [{ region: "Maharashtra (Mumbai)", checks: 20 }] },
        pincodes: [pin("395007", 10, 5)],
      }),
    );
    expect(r.insights.map((i) => i.kind)).toEqual(["RTO_SPIKE", "RISK_QUEUE", "SALES_TREND", "DEMAND_GAP"]);
    expect(r.insights.find((i) => i.kind === "SALES_TREND")?.title).toMatch(/down 67%/);
    expect(r.summary).toMatch(/3 things need attention/);
  });
});

describe("accepting a copilot's answer", () => {
  const c = ctx({ pincodes: [pin("395007", 10, 5)], payments: [{ method: "upi", label: "UPI", status: "DOWN", recentRate: 0.2, baseline: 0.9, attempts: 20, advisoryActive: false }] });

  it("keeps well-formed insights and actions that point at real pincodes and methods", () => {
    const r = parseCopilotReport(
      {
        summary: "Two issues.",
        model: "llama3.1:8b",
        insights: [
          { id: "a", kind: "RTO_SPIKE", severity: "critical", title: "395007 is refusing", detail: "d", action: { type: "DISABLE_COD", pincode: "395007" } },
          { id: "b", kind: "PAYMENT_FRICTION", severity: "warning", title: "UPI down", detail: "d", action: { type: "PRIORITIZE_BACKUP_METHOD", method: "upi" } },
        ],
      },
      c,
    );
    expect(r?.source).toBe("llm");
    expect(r?.model).toBe("llama3.1:8b");
    expect(r?.insights.map((i) => i.action?.type)).toEqual(["DISABLE_COD", "PRIORITIZE_BACKUP_METHOD"]);
  });

  it("drops made-up insights, strips actions for pincodes not in the data, and refuses outside links", () => {
    const r = parseCopilotReport(
      {
        summary: "s",
        insights: [
          { id: "x", kind: "NONSENSE", severity: "critical", title: "t", detail: "d" },
          { id: "y", kind: "RTO_SPIKE", severity: "warning", title: "t", detail: "d", action: { type: "DISABLE_COD", pincode: "110001" } },
          { id: "z", kind: "INFO", severity: "info", title: "t", detail: "d", action: { type: "OPEN", href: "https://evil.example", label: "Go" } },
          "not an object",
        ],
      },
      c,
    );
    expect(r?.insights.map((i) => i.id)).toEqual(["y"]);
    expect(r?.insights[0].action).toBeUndefined();
  });

  it("keeps a button only when the figures back it, so text planted in the data can't add one", () => {
    const quiet = ctx({
      pincodes: [pin("380015", 20, 1)],
      payments: [{ method: "upi", label: "UPI", status: "OK", recentRate: 0.93, baseline: 0.9, attempts: 30, advisoryActive: false }],
    });
    const r = parseCopilotReport(
      {
        summary: "s",
        insights: [
          { id: "a", kind: "RTO_SPIKE", severity: "critical", title: "t", detail: "d", action: { type: "DISABLE_COD", pincode: "380015" } },
          { id: "b", kind: "PAYMENT_FRICTION", severity: "critical", title: "t", detail: "d", action: { type: "PRIORITIZE_BACKUP_METHOD", method: "upi" } },
          { id: "c", kind: "CHURN_RISK", severity: "info", title: "t", detail: "d", action: { type: "EXPORT_COHORT", cohort: "churn-high-ltv" } },
        ],
      },
      quiet,
    );
    expect(r?.insights.map((i) => i.action)).toEqual([undefined, undefined, undefined]);
  });

  it("rejects an answer that isn't the agreed shape at all", () => {
    expect(parseCopilotReport({ hello: "world" }, c)).toBeNull();
    expect(parseCopilotReport("just text", c)).toBeNull();
    expect(parseCopilotReport({ summary: "x".repeat(2000), insights: [] }, c)).toBeNull();
  });
});

describe("copilot chat without a model", () => {
  it("routes questions to topics", () => {
    expect(chatTopic("Which pincodes had high RTO this week?")).toBe("rto");
    expect(chatTopic("Draft a re-engagement offer for inactive users")).toBe("offer");
    expect(chatTopic("is UPI failing?")).toBe("payments");
    expect(chatTopic("who has gone quiet")).toBe("churn");
    expect(chatTopic("how were sales")).toBe("sales");
    expect(chatTopic("what's up")).toBe("help");
  });

  it("answers from the figures and attaches the matching cards", () => {
    const c = ctx({ pincodes: [pin("395007", 10, 5)], churn: { inactiveDays: 45, count: 3, totalLtvPaise: 9000_00, ltvThresholdPaise: 2500_00, marketingConsent: 2 } });
    const rto = answerWithRules("Which pincodes had high RTO?", c);
    expect(rto.reply).toMatch(/395007/);
    expect(rto.insights[0].kind).toBe("RTO_SPIKE");
    const offer = answerWithRules("draft a win back offer", c);
    expect(offer.reply).toMatch(/2 lapsed high-value buyers who agreed to offers/);
    expect(offer.reply).toMatch(/Reply STOP/);
  });
});

describe("copilot address rules", () => {
  it("allows only https ngrok addresses on the live site, keeping just the origin", () => {
    expect(checkCopilotUrl("https://abcd-1234.ngrok-free.app/some/path?x=1")).toEqual({ ok: true, url: "https://abcd-1234.ngrok-free.app" });
    expect(checkCopilotUrl("https://x.ngrok.app").ok).toBe(true);
    expect(checkCopilotUrl("http://abcd.ngrok-free.app").ok).toBe(false);
    expect(checkCopilotUrl("https://ngrok-free.app").ok).toBe(false);
    expect(checkCopilotUrl("https://evil-ngrok-free.app").ok).toBe(false);
    expect(checkCopilotUrl("https://abcd.ngrok-free.app.evil.com").ok).toBe(false);
    expect(checkCopilotUrl("https://169.254.169.254").ok).toBe(false);
    expect(checkCopilotUrl("https://user:pw@abcd.ngrok-free.app").ok).toBe(false);
    expect(checkCopilotUrl("https://abcd.ngrok-free.app:8443").ok).toBe(false);
    expect(checkCopilotUrl("not a url").ok).toBe(false);
  });

  it("allows localhost only while developing, and extra hosts only when named", () => {
    expect(checkCopilotUrl("http://localhost:8000").ok).toBe(false);
    expect(checkCopilotUrl("http://localhost:8000", { dev: true })).toEqual({ ok: true, url: "http://localhost:8000" });
    // Pinned to the owner's reserved domain: only that host, not other ngrok ones.
    expect(checkCopilotUrl("https://soulone-ai.ngrok.app", { dev: false, pinnedHosts: ["soulone-ai.ngrok.app"] }).ok).toBe(true);
    expect(checkCopilotUrl("https://someone-else.ngrok-free.app", { dev: false, pinnedHosts: ["soulone-ai.ngrok.app"] }).ok).toBe(false);
  });

  it("masks a stored token", () => {
    expect(maskToken("abcdefghij1234")).toBe("••••1234");
    expect(maskToken(null)).toBeNull();
  });
});
