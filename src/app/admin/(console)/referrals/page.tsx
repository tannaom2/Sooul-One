import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { NoAccess } from "@/components/ui";
import { decimalToPaise, formatDate } from "@/lib/format";
import { formatPriceTag } from "@/lib/money";
import { maskMobile } from "@/lib/mobile";
import { getProgram } from "@/server/referrals";
import { ActionForm } from "../boxes/action-form";
import { decideReferral, saveProgram } from "./actions";

export const dynamic = "force-dynamic";

const STAGE: Record<string, string> = {
  ATTRIBUTED: "Signed up",
  QUALIFYING: "First order placed",
  HELD: "Delivered, in return window",
  REWARDED: "Rewarded",
  VOID: "Void",
  EXPIRED: "Expired",
};

const TABS = [
  { key: "review", label: "Needs review" },
  { key: "held", label: "Held" },
  { key: "open", label: "In progress" },
  { key: "all", label: "All" },
] as const;

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requirePermission("settings:manage");
  if (!session) return <NoAccess />;
  const tab = (await searchParams).tab ?? "review";

  const where =
    tab === "review"
      ? { flagged: true, status: { in: ["ATTRIBUTED", "QUALIFYING", "HELD"] as ("ATTRIBUTED" | "QUALIFYING" | "HELD")[] } }
      : tab === "held"
        ? { status: "HELD" as const }
        : tab === "open"
          ? { status: { in: ["ATTRIBUTED", "QUALIFYING"] as ("ATTRIBUTED" | "QUALIFYING")[] } }
          : {};
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [program, referrals, counts, issuedThisMonth] = await Promise.all([
    getProgram(),
    db.referral.findMany({
      where,
      include: {
        referrer: { select: { name: true, phone: true } },
        referee: { select: { name: true, phone: true } },
        code: { select: { code: true, timesRedeemed: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    db.referral.groupBy({ by: ["status"], _count: true }),
    db.walletEntry.aggregate({ where: { kind: "REFERRAL_CREDIT", createdAt: { gte: monthStart } }, _sum: { amount: true } }),
  ]);
  const orders = await db.order.findMany({
    where: { id: { in: referrals.map((r) => r.qualifyingOrderId).filter((x): x is string => Boolean(x)) } },
    select: { id: true, orderNumber: true, status: true },
  });
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const flaggedCount = await db.referral.count({ where: { flagged: true, status: { in: ["ATTRIBUTED", "QUALIFYING", "HELD"] } } });
  const issued = decimalToPaise(issuedThisMonth._sum.amount ?? 0);

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Referrals</h1>
        <p className="mt-2 max-w-[66ch] text-ink-soft">
          A friend gets money off their first order; the referrer earns credit once that order is delivered and past the return
          window, up to the cap. Risky referrals and anything over the monthly budget wait here for you.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Rewarded", String(count("REWARDED"))],
          ["Waiting for delivery or window", String(count("QUALIFYING") + count("HELD"))],
          ["Needs review", String(flaggedCount)],
          ["Credit issued this month", `${formatPriceTag(issued)}${program.monthlyBudgetPaise != null ? ` of ${formatPriceTag(program.monthlyBudgetPaise)}` : ""}`],
        ].map(([label, value]) => (
          <div key={label} className="panel p-3.5">
            <p className="text-micro text-ink-faint">{label}</p>
            <p className="mt-1 font-display text-h3 font-bold tabular">{value}</p>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head flex items-center justify-between">
          <span>Programme rules</span>
          <span className={`text-micro font-semibold ${program.isActive ? "text-veg" : "text-ink-faint"}`}>{program.isActive ? "Running" : "Off"}</span>
        </div>
        <ActionForm action={saveProgram} submitLabel="Save rules" className="grid gap-3 p-3.5 sm:grid-cols-3">
          <label className="flex items-start gap-2 text-small sm:col-span-3">
            <input type="checkbox" name="isActive" defaultChecked={program.isActive} className="mt-1" />
            <span>Programme running (shoppers see &ldquo;Invite friends&rdquo; and links work)</span>
          </label>
          {(
            [
              ["referrerReward", "Referrer's reward (₹ credit)", program.referrerRewardPaise / 100],
              ["refereeReward", "Friend's first-order discount (₹)", program.refereeRewardPaise / 100],
              ["minOrderValue", "Minimum order, after offers (₹)", program.minOrderPaise / 100],
              ["maxCreditPerOrder", "Most credit per order (₹)", program.maxCreditPerOrderPaise / 100],
              ["maxRewardsPerReferrer", "Rewards per referrer, at most", program.maxRewardsPerReferrer],
              ["holdDays", "Days after delivery before paying", program.holdDays],
              ["attributionDays", "Days a friend has to order", program.attributionDays],
              ["creditExpiryDays", "Days before credit expires", program.creditExpiryDays],
              ["riskThreshold", "Review at this risk score or above", program.riskThreshold],
            ] as const
          ).map(([name, label, value]) => (
            <label key={name} className="grid gap-1 text-small">
              <span className="label">{label}</span>
              <input name={name} type="number" min={0} className="field" defaultValue={value} required />
            </label>
          ))}
          <label className="grid gap-1 text-small">
            <span className="label">Monthly budget (₹, blank for none)</span>
            <input name="monthlyBudget" type="number" min={0} className="field" defaultValue={program.monthlyBudgetPaise == null ? "" : program.monthlyBudgetPaise / 100} />
          </label>
          <label className="flex items-start gap-2 text-small sm:col-span-2">
            <input type="checkbox" name="refereeDiscountAfterCap" defaultChecked={program.refereeDiscountAfterCap} className="mt-1" />
            <span>After a referrer&rsquo;s last reward, their link still gives friends the discount (costs margin; off by default)</span>
          </label>
        </ActionForm>
      </section>

      <section>
        <nav className="flex flex-wrap gap-2" aria-label="Filter referrals">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin/referrals?tab=${t.key}`}
              replace
              className={`border px-3 py-1.5 text-small ${tab === t.key ? "border-primary bg-primary text-on-primary" : "border-rule"}`}
              style={{ borderRadius: 999 }}
            >
              {t.label}
              {t.key === "review" && flaggedCount > 0 && <span className="ml-1.5 tabular">{flaggedCount}</span>}
            </Link>
          ))}
        </nav>

        {referrals.length === 0 ? (
          <p className="panel mt-4 p-4 text-small text-ink-soft">Nothing here.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {referrals.map((r) => {
              const signals = (r.riskSignals as { all?: string[]; atSignUp?: string[] } | null) ?? null;
              const reasons = signals?.all ?? signals?.atSignUp ?? [];
              const order = r.qualifyingOrderId ? orderById.get(r.qualifyingOrderId) : undefined;
              const open = ["ATTRIBUTED", "QUALIFYING", "HELD"].includes(r.status);
              return (
                <li key={r.id} className={`panel ${r.flagged ? "border-alert" : ""}`}>
                  <div className="panel-head flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {r.referrer.name || "—"} <span className="font-normal text-ink-faint">({r.referrer.phone ? maskMobile(r.referrer.phone) : "—"}, code {r.code.code})</span>
                      {" → "}
                      {r.referee.name || "New customer"} <span className="font-normal text-ink-faint">({r.referee.phone ? maskMobile(r.referee.phone) : "—"})</span>
                    </span>
                    <span className="text-micro font-normal">
                      {STAGE[r.status]}
                      {r.voidReason && ` · ${r.voidReason.replace(/_/g, " ")}`}
                    </span>
                  </div>
                  <div className="grid gap-2 p-3.5 text-small">
                    <p className="text-ink-soft">
                      Signed up {formatDate(r.attributedAt)} via {r.via === "LINK" ? "link" : "typed code"}
                      {order && (
                        <>
                          {" · first order "}
                          <Link href={`/admin/orders/${order.id}`} className="underline">
                            {order.orderNumber}
                          </Link>
                          {` (${order.status.toLowerCase()})`}
                        </>
                      )}
                      {r.holdUntil && r.status === "HELD" && ` · pays from ${formatDate(r.holdUntil)}`}
                      {` · referrer has ${r.code.timesRedeemed} of ${program.maxRewardsPerReferrer} rewards`}
                    </p>
                    <p>
                      Risk score <strong className={r.riskScore >= program.riskThreshold ? "text-alert" : ""}>{r.riskScore}</strong>
                      {reasons.length > 0 ? `: ${reasons.join("; ")}` : ": no signals"}
                    </p>
                    {open && (
                      <div className="flex flex-wrap gap-3 border-t border-rule pt-3">
                        {r.flagged && (
                          <ActionForm action={decideReferral} submitLabel="Looks fine" variant="outline" className="flex items-center gap-2">
                            <input type="hidden" name="referralId" value={r.id} />
                            <input type="hidden" name="decision" value="review" />
                          </ActionForm>
                        )}
                        {r.status === "HELD" && (
                          <ActionForm action={decideReferral} submitLabel="Pay reward now" variant="outline" confirmText="Pay this reward now, before the return window ends?" className="flex items-center gap-2">
                            <input type="hidden" name="referralId" value={r.id} />
                            <input type="hidden" name="decision" value="pay" />
                          </ActionForm>
                        )}
                        <ActionForm action={decideReferral} submitLabel="Void" variant="outline" confirmText="Void this referral? No reward will be paid." className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="referralId" value={r.id} />
                          <input type="hidden" name="decision" value="void" />
                          <input name="reason" className="field max-w-[14rem] py-1.5" placeholder="Reason (optional)" maxLength={200} />
                        </ActionForm>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
