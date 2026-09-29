import { getInsights } from "@/server/copilot";
import { reportError } from "@/lib/observability";
import { InsightCards } from "@/components/insight-cards";

/**
 * Insight cards on the Overview. Streamed in (the page wraps this in
 * Suspense), since asking the owner's local copilot can take a few seconds;
 * the rest of the dashboard never waits for it, and any failure shows the
 * built-in rules instead.
 */
export async function DashboardInsights({ canAct }: { canAct: boolean }) {
  let result: Awaited<ReturnType<typeof getInsights>>;
  try {
    result = await getInsights();
  } catch (error) {
    reportError("dashboard-insights", error);
    return <p className="panel p-4 text-small text-ink-soft">Insights couldn&apos;t be worked out just now. The reports under Analytics still work.</p>;
  }
  const { report, fallbackReason } = result;
  return (
    <div className="grid gap-3">
      <p className="text-small text-ink-soft">
        {report.summary}{" "}
        <span className="text-micro text-ink-faint">
          {report.source === "llm" ? `From your local copilot${report.model ? ` (${report.model})` : ""}.` : "From the built-in rules."}
          {fallbackReason && ` Using the rules because ${fallbackReason}.`}
        </span>
      </p>
      <InsightCards insights={report.insights} canAct={canAct} />
    </div>
  );
}

export function DashboardInsightsLoading() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Working out insights">
      {[0, 1, 2].map((i) => (
        <div key={i} className="panel h-36 animate-pulse bg-shelf" />
      ))}
    </div>
  );
}
