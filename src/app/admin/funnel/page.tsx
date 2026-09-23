import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { buildFunnel, findAbandonedCarts } from "@/lib/funnel";
import { formatDate } from "@/lib/format";
import { Empty, NoAccess } from "@/components/ui";

export const dynamic = "force-dynamic";

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requirePermission("finance:view");
  if (!session) return <NoAccess />;

  const { days: daysParam } = await searchParams;
  const days = Math.max(1, Math.min(365, Number(daysParam) || 30));

  const [funnel, abandoned] = await Promise.all([buildFunnel(days), findAbandonedCarts(7, 50)]);

  // Bars scale to the largest stage, not the first, so a later stage can
  // never draw wider than its card (it did, when visits read zero).
  const maxSessions = Math.max(0, ...funnel.stages.map((s) => s.sessions));
  // A later step can't genuinely outnumber an earlier one; when it does, the
  // earlier step wasn't being recorded for part of the window.
  const undercounted = funnel.stages.some((s, i) => i > 0 && s.sessions > funnel.stages[i - 1].sessions);

  return (
    <div className="grid gap-10">
      <div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-h2 font-extrabold">Purchase funnel</h1>
          <div className="flex items-center gap-3 text-small">
            <span className="text-ink-faint">Last</span>
            {[7, 30, 90].map((d) => (
              <Link
                key={d}
                href={`/admin/funnel?days=${d}`}
                className={d === days ? "font-semibold underline" : "text-ink-soft hover:underline"}
              >
                {d} days
              </Link>
            ))}
          </div>
        </div>

        {maxSessions === 0 ? (
          <Empty title="No traffic yet" detail="The funnel fills in as shoppers visit the site." />
        ) : (
          <div className="grid gap-3">
            {undercounted && (
              <p className="border-l-4 border-caution bg-shelf px-4 py-3 text-small">
                Some steps show more sessions than the step before them, so rates over 100% here
                aren&apos;t real conversion rates. Visit tracking only started working on 24 Sept 2026;
                earlier sessions have product views but no recorded visit. This clears once the
                selected period no longer reaches back before that date.
              </p>
            )}
            {funnel.stages.map((stage) => (
              <div key={stage.type} className="panel p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{stage.label}</p>
                  <p className="tabular text-small text-ink-faint">
                    {stage.sessions.toLocaleString()} {stage.sessions === 1 ? "session" : "sessions"}
                    {stage.type !== "VISIT" && <> · {pct(stage.conversionFromPrevious)} of previous step</>}
                    {" · "}
                    {pct(stage.conversionFromStart)} of visitors
                  </p>
                </div>
                <div className="h-2 w-full bg-shelf">
                  <div
                    className="h-2 bg-ink"
                    style={{ width: `${Math.max(2, (stage.sessions / maxSessions) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-h3 font-bold">Abandoned carts</h2>
        <p className="mb-4 max-w-2xl text-small text-ink-soft">
          Added something to the basket in the last 7 days but never reached checkout — the
          sessions worth a recovery email once that feature exists. Someone who reached checkout
          and still didn&apos;t pay is a different problem and isn&apos;t counted here.
        </p>
        {abandoned.length === 0 ? (
          <p className="text-small text-ink-faint">No abandoned baskets in the last 7 days.</p>
        ) : (
          <div className="grid gap-2">
            {abandoned.map((row) => (
              <div key={row.sessionId} className="panel flex flex-wrap items-center justify-between gap-2 p-3">
                <p className="text-small">{row.productNames.join(", ")}</p>
                <p className="tabular text-micro text-ink-faint">{formatDate(row.lastAddedAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
