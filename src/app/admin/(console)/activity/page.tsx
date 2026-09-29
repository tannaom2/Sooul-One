import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { BarList, ChartCard, Pager, StackedBar, SERIES, BAD } from "@/components/charts";
import { INTEL_PAGE_SIZE } from "@/lib/intel/paging";
import { stepUpExpiry } from "@/lib/step-up";
import { lockActivity } from "./actions";

export const dynamic = "force-dynamic";

/** The 10-item rule: ten entries per page, charts of those ten beside them. */
const PAGE_SIZE = INTEL_PAGE_SIZE;

// Only these areas can be filtered on; anything else in the URL is ignored.
const AREAS: Record<string, string> = {
  Product: "Products",
  Order: "Orders",
  ProductBatch: "Stock batches",
  Bundle: "Bundles",
  Box: "Boxes",
  Referral: "Referrals",
  ReferralProgram: "Referral rules",
  Review: "Reviews",
  StoreLocation: "Stores",
  ProductImage: "Images",
  AdminUser: "Team & sign-ins",
  PincodeRule: "Pincode rules",
  MarketingSpend: "Marketing spend",
  StoreSettings: "Store controls",
  Customer: "Customer exports",
  PaymentReconciliation: "Reconciliation",
};

const WARNING_ACTIONS = new Set(["SIGN_IN_FAILED", "SIGN_IN_LOCKED", "MFA_FAILED", "MFA_LOCKED", "STEP_UP_FAILED", "STEP_UP_LOCKED", "DELETE_BUNDLE", "DELETE_BOX", "REFERRAL_PAY", "REFERRAL_VOID", "TEAM_DEACTIVATE", "TEAM_RESET_ACCESS"]);

const when = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function humanise(action: string): string {
  const s = action.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Field diffs read as "field: from → to"; anything else as "key: value". */
function describeChanges(changes: unknown): string[] {
  if (!changes || typeof changes !== "object") return [];
  return Object.entries(changes as Record<string, unknown>).map(([key, value]) => {
    if (value && typeof value === "object" && "from" in value && "to" in value) {
      const v = value as { from: unknown; to: unknown };
      return `${key}: ${show(v.from)} → ${show(v.to)}`;
    }
    return `${key}: ${show(value)}`;
  });
}

/** Occurrences of each value, most frequent first. */
function count(values: readonly string[]): [string, number][] {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function entityHref(entityType: string, entityId: string): string | null {
  if (entityType === "Product") return `/admin/products/${entityId}`;
  if (entityType === "Order") return `/admin/orders/${entityId}`;
  if (entityType === "AdminUser" && entityId !== "-") return "/admin/team";
  return null;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; area?: string; page?: string }>;
}) {
  // Owner only (audit:view), and then a fresh authenticator code for a
  // ten-minute pass on this browser (src/lib/step-up.ts).
  const session = await requirePermission("audit:view");
  if (!session) return <NoAccess />;
  const passUntil = await stepUpExpiry(session);
  if (!passUntil) redirect("/admin/activity/verify");

  const params = await searchParams;
  const admins = await db.adminUser.findMany({ select: { id: true, email: true }, orderBy: { email: "asc" } });

  // Validate every URL parameter against a known list or range — never pass
  // raw query-string values into the database query.
  const actor = admins.some((a) => a.id === params.actor) ? params.actor : undefined;
  const area = params.area && params.area in AREAS ? params.area : undefined;
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(params.page)) || 1));

  const where = { ...(actor && { adminUserId: actor }), ...(area && { entityType: area }) };
  const [entries, total] = await Promise.all([
    db.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.adminAuditLog.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (actor) q.set("actor", actor);
    if (area) q.set("area", area);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return `/admin/activity${s ? `?${s}` : ""}`;
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 font-extrabold">Activity</h1>
          <p className="mt-2 max-w-[62ch] text-small text-ink-soft">
            Every change made in the console, and every sign-in attempt. This log can&apos;t be edited or
            deleted — not from here, and not directly in the database.
          </p>
        </div>
        <form action={lockActivity} className="grid justify-items-end gap-1 text-micro text-ink-faint">
          <span>Access on this browser until {when.format(passUntil)}</span>
          <button className="btn btn-outline px-3 py-1.5 text-small">Lock now</button>
        </form>
      </div>

      {/* Keyed on the filters so its fields reset when they change from outside it
          (a status tab, Clear, Back); defaultValue alone only applies on first mount. */}
      <form key={`${actor ?? ""}|${area ?? ""}`} method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-small">
          <span className="label">Person</span>
          <AutoSubmitSelect name="actor" defaultValue={actor ?? ""} className="field w-auto">
            <option value="">Everyone</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </AutoSubmitSelect>
        </label>
        <label className="text-small">
          <span className="label">Area</span>
          <AutoSubmitSelect name="area" defaultValue={area ?? ""} className="field w-auto">
            <option value="">All areas</option>
            {Object.entries(AREAS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </AutoSubmitSelect>
        </label>
        <button className="btn btn-outline px-4 py-2 text-small">Filter</button>
        {(actor || area) && (
          <Link href="/admin/activity" className="pb-2 text-small underline">
            Clear
          </Link>
        )}
      </form>

      {entries.length === 0 ? (
        <Empty title="Nothing recorded" detail="Changes and sign-ins matching these filters will appear here." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
          <div className="grid gap-3">
            <p className="text-micro text-ink-faint">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}, newest first
            </p>
            <div className="panel">
              {entries.map((e) => {
                const href = entityHref(e.entityType, e.entityId);
                const lines = describeChanges(e.changes);
                const warn = WARNING_ACTIONS.has(e.action);
                return (
                  <div key={e.id} className="grid gap-1 border-b border-rule px-4 py-3 last:border-b-0 sm:grid-cols-[11rem_1fr]">
                    <div className="text-micro text-ink-faint">
                      <p className="tabular">{when.format(e.createdAt)}</p>
                      {e.ipAddress && (
                        <p className="truncate tabular" title={e.userAgent ?? undefined}>
                          {e.ipAddress}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0 text-small">
                      <p>
                        <span className={warn ? "font-semibold text-alert" : "font-semibold"}>{humanise(e.action)}</span>
                        <span className="text-ink-soft"> · {e.actorEmail ?? "unknown"}</span>
                        {e.entityId !== "-" && (
                          <>
                            {" · "}
                            {href ? (
                              <Link href={href} className="underline">
                                {AREAS[e.entityType] ?? e.entityType}
                              </Link>
                            ) : (
                              <span className="text-ink-faint">{AREAS[e.entityType] ?? e.entityType}</span>
                            )}
                          </>
                        )}
                      </p>
                      {lines.length > 0 && (
                        <ul className="mt-1 grid gap-0.5 text-micro break-words text-ink-soft">
                          {lines.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Pager page={page} pages={pages} href={pageHref} />
          </div>
          <div className="grid gap-4">
            <ChartCard title="What happened" note="The ten entries on this page">
              <BarList rows={count(entries.map((e) => humanise(e.action))).map(([label, value]) => ({ label, value, color: WARNING_ACTIONS.has(label.toUpperCase().replace(/ /g, "_")) ? BAD : SERIES[0] }))} />
            </ChartCard>
            <ChartCard title="Who">
              <BarList rows={count(entries.map((e) => e.actorEmail ?? "unknown")).map(([label, value]) => ({ label, value, color: SERIES[1] }))} />
            </ChartCard>
            <ChartCard title="Warnings among them" note="Failed sign-ins and codes, deletions, payouts, access changes">
              <StackedBar
                parts={[
                  { label: "Warnings", value: entries.filter((e) => WARNING_ACTIONS.has(e.action)).length, color: BAD },
                  { label: "Routine", value: entries.filter((e) => !WARNING_ACTIONS.has(e.action)).length, color: SERIES[2] },
                ]}
              />
            </ChartCard>
            <ChartCard title="Where from" note="Distinct addresses on this page">
              <BarList rows={count(entries.map((e) => e.ipAddress?.split(",")[0]?.trim() || "not recorded")).map(([label, value]) => ({ label, value, color: SERIES[4] }))} />
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}
