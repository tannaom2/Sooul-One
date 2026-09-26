import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { gateEnforced, type ItemStatus, type Readiness } from "@/lib/launch-readiness";
import { getReadiness } from "@/server/launch-readiness";

export const dynamic = "force-dynamic";

const MARK: Record<ItemStatus, { symbol: string; label: string; color: string }> = {
  done: { symbol: "✓", label: "Done", color: "var(--color-veg)" },
  missing: { symbol: "✕", label: "Missing", color: "var(--color-alert)" },
  warning: { symbol: "!", label: "Recommended", color: "var(--color-caution)" },
  manual: { symbol: "?", label: "Check yourself", color: "var(--color-ink-faint)" },
};

export default async function LaunchChecklist() {
  const session = await requirePermission("settings:manage");
  if (!session) return <NoAccess />;

  let readiness: Readiness;
  try {
    readiness = await getReadiness();
  } catch (error) {
    reportError("admin/launch", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }
  const groups = [...new Set(readiness.items.map((i) => i.group))];
  const enforced = gateEnforced(process.env.SITE_URL, process.env.LAUNCH_GATE);
  const blockers = readiness.blockers.length;

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Launch checklist</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          Everything that has to be in place before the live site takes orders. Items marked Missing keep checkout
          closed on the public site; Recommended items don&apos;t, but are worth doing first.
        </p>
        <p
          className="mt-4 max-w-[62ch] border-l-4 bg-shelf p-3 text-small"
          style={{ borderColor: blockers ? "var(--color-alert)" : "var(--color-veg)" }}
        >
          {blockers
            ? `${blockers} item${blockers === 1 ? "" : "s"} left before orders can open.`
            : "Everything required is done. The live site is taking orders."}{" "}
          {enforced
            ? blockers
              ? "Checkout on the live site shows “Opening soon” until then."
              : ""
            : "This server isn't the public site, so checkout stays open here for testing."}
        </p>
      </div>

      {groups.map((group) => (
        <section key={group} className="panel" aria-labelledby={`g-${group}`}>
          <h2 id={`g-${group}`} className="panel-head">
            {group}
          </h2>
          <ul>
            {readiness.items
              .filter((i) => i.group === group)
              .map((item) => {
                const mark = MARK[item.status];
                return (
                  <li key={item.id} className="flex gap-3 border-t border-rule px-3.5 py-3 text-small first:border-t-0">
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center text-micro font-bold text-paper"
                      style={{ background: mark.color, borderRadius: 999 }}
                    >
                      {mark.symbol}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {item.label}
                        <span className="sr-only"> ({mark.label})</span>
                        {item.blocking && item.status !== "done" && (
                          <span className="ml-2 text-micro font-semibold text-alert">Required</span>
                        )}
                      </p>
                      {item.detail && <p className="text-ink-soft">{item.detail}</p>}
                    </div>
                    {item.href && item.status !== "done" && (
                      <Link href={item.href} className="shrink-0 self-center underline">
                        Fix
                      </Link>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
