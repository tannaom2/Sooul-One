import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// Only these areas can be filtered on; anything else in the URL is ignored.
const AREAS: Record<string, string> = {
  Product: "Products",
  Order: "Orders",
  ProductBatch: "Stock batches",
  Bundle: "Bundles",
  Review: "Reviews",
  StoreLocation: "Stores",
  ProductImage: "Images",
  AdminUser: "Team & sign-ins",
  PaymentReconciliation: "Reconciliation",
};

const WARNING_ACTIONS = new Set(["SIGN_IN_FAILED", "SIGN_IN_LOCKED", "MFA_FAILED", "MFA_LOCKED", "DELETE_BUNDLE", "TEAM_DEACTIVATE", "TEAM_RESET_ACCESS"]);

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
  const session = await requirePermission("audit:view");
  if (!session) return <NoAccess />;

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
      <div>
        <h1 className="text-h2 font-extrabold">Activity</h1>
        <p className="mt-2 max-w-[62ch] text-small text-ink-soft">
          Every change made in the console, and every sign-in attempt. This log can&apos;t be edited or
          deleted — not from here, and not directly in the database.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-small">
          <span className="label">Person</span>
          <select name="actor" defaultValue={actor ?? ""} className="field w-auto">
            <option value="">Everyone</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        </label>
        <label className="text-small">
          <span className="label">Area</span>
          <select name="area" defaultValue={area ?? ""} className="field w-auto">
            <option value="">All areas</option>
            {Object.entries(AREAS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
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
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-4 text-small">
          {page > 1 && <Link href={pageHref(page - 1)} className="underline">Newer</Link>}
          <span className="text-ink-faint tabular">
            Page {page} of {pages}
          </span>
          {page < pages && <Link href={pageHref(page + 1)} className="underline">Older</Link>}
        </nav>
      )}
    </div>
  );
}
