import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { BarList, ChartCard, Stat, BAD, SERIES } from "@/components/charts";
import { reportError } from "@/lib/observability";
import { INTEL_PAGE_SIZE } from "@/lib/intel/paging";
import { daysAgo, istDate, parseDays, pct, reportHref } from "../format";

export const dynamic = "force-dynamic";

interface Row {
  key: string;
  n: number;
  misses: number;
  last: Date;
}

/**
 * What shoppers look for: storefront searches (and the ones that found
 * nothing, which are a product, FAQ or wording gap) and batch checks (codes
 * that keep failing are misprints, a missing batch record, or fakes).
 */
export default async function SiteReport({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requirePermission("content:write");
  if (!session) return <NoAccess />;
  const windowDays = parseDays((await searchParams).days, 30);
  const since = daysAgo(windowDays);

  let searches: Row[] = [];
  let batches: Row[] = [];
  let totals = { searches: 0, empty: 0, checks: 0, notFound: 0 };
  try {
    const [s, b] = await Promise.all([
      db.$queryRaw<{ key: string; n: bigint; misses: bigint; last: Date }[]>`
        SELECT metadata->>'q' AS key, count(*) AS n, count(*) FILTER (WHERE (metadata->>'results')::int = 0) AS misses, max("createdAt") AS last
        FROM "AnalyticsEvent" WHERE type = 'SEARCHED' AND "createdAt" >= ${since} AND metadata->>'q' IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT 500`,
      db.$queryRaw<{ key: string; n: bigint; misses: bigint; last: Date }[]>`
        SELECT metadata->>'batch' AS key, count(*) AS n, count(*) FILTER (WHERE NOT (metadata->>'found')::boolean) AS misses, max("createdAt") AS last
        FROM "AnalyticsEvent" WHERE type = 'BATCH_CHECKED' AND "createdAt" >= ${since} AND metadata->>'batch' IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT 500`,
    ]);
    const conv = (r: { key: string; n: bigint; misses: bigint; last: Date }): Row => ({ key: r.key, n: Number(r.n), misses: Number(r.misses), last: new Date(r.last) });
    searches = s.map(conv);
    batches = b.map(conv);
    totals = {
      searches: searches.reduce((t, r) => t + r.n, 0),
      empty: searches.reduce((t, r) => t + r.misses, 0),
      checks: batches.reduce((t, r) => t + r.n, 0),
      notFound: batches.reduce((t, r) => t + r.misses, 0),
    };
  } catch (error) {
    reportError("admin/analytics/site", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  const top = searches.slice(0, INTEL_PAGE_SIZE);
  const empty = searches.filter((r) => r.misses > 0).sort((a, b) => b.misses - a.misses).slice(0, INTEL_PAGE_SIZE);
  const failing = batches.filter((r) => r.misses > 0).sort((a, b) => b.misses - a.misses).slice(0, INTEL_PAGE_SIZE);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2 font-extrabold">Search and batch checks</h1>
          <p className="mt-1 max-w-[72ch] text-small text-ink-soft">
            What shoppers typed into search and the batch check in the last {windowDays} days. Searches with no results point
            at a missing product, FAQ or word; batch codes that keep failing are a misprint, a batch not yet recorded under
            Stock batches, or a fake.
          </p>
        </div>
        <nav aria-label="Window" className="flex gap-1 text-small">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={reportHref("/admin/analytics/site", { days: d === 30 ? undefined : d })} aria-current={d === windowDays ? "page" : undefined} className={`border px-2 py-1 ${d === windowDays ? "border-ink font-semibold" : "border-rule text-ink-soft"}`}>
              {d} days
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Searches" value={totals.searches.toLocaleString("en-IN")} />
        <Stat label="Found nothing" value={pct(totals.searches ? totals.empty / totals.searches : null)} tone={totals.searches && totals.empty / totals.searches > 0.2 ? "bad" : undefined} sub={`${totals.empty} searches`} />
        <Stat label="Batch checks" value={totals.checks.toLocaleString("en-IN")} />
        <Stat label="Batch not found" value={pct(totals.checks ? totals.notFound / totals.checks : null)} tone={totals.notFound > 0 ? "bad" : undefined} sub={`${totals.notFound} checks`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Top searches" note="Ten most searched, with how many found nothing">
          {top.length ? <BarList rows={top.map((r) => ({ label: r.key, value: r.n, display: r.misses ? `${r.n} · ${r.misses} empty` : String(r.n), color: r.misses === r.n ? BAD : SERIES[0] }))} /> : <p className="text-small text-ink-soft">No searches yet.</p>}
        </ChartCard>
        <ChartCard title="Searches that found nothing" note="Add the product, an FAQ, or the word to a product's description">
          {empty.length ? <BarList rows={empty.map((r) => ({ label: r.key, value: r.misses, color: BAD }))} /> : <p className="text-small text-ink-soft">Every search found something.</p>}
        </ChartCard>
      </div>

      <section aria-labelledby="failing">
        <h2 id="failing" className="mb-3 text-h3 font-bold">
          Batch codes not found
        </h2>
        {failing.length === 0 ? (
          <p className="text-small text-ink-soft">Every batch checked matched a recorded batch.</p>
        ) : (
          <div className="panel">
            <div className="panel-row font-semibold">
              <span>Code typed (cleaned up)</span>
              <span>Times · last seen</span>
            </div>
            {failing.map((r) => (
              <div key={r.key} className="panel-row">
                <span className="tabular">{r.key}</span>
                <span className="tabular">
                  {r.misses} · {istDate.format(r.last)}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-micro text-ink-soft">
          A code checked many times from different shoppers that isn&apos;t yours is worth a look. Check it isn&apos;t a batch
          you forgot to record under{" "}
          <Link href="/admin/batches" className="underline underline-offset-2">
            Stock batches
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
