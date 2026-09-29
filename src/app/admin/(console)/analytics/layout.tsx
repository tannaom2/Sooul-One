import { AnalyticsTabs } from "./analytics-tabs";

/** Analytics and the intelligence reports share one tab bar (docs/INTELLIGENCE.md). */
export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-6">
      <AnalyticsTabs />
      {children}
    </div>
  );
}
