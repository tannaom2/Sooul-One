import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { AnalyticsTabs } from "./analytics-tabs";
import { ANALYTICS_TABS } from "./tabs";

/**
 * Analytics and the intelligence reports share one tab bar (docs/INTELLIGENCE.md),
 * showing only the tabs this person's role can open: each report still checks
 * its own permission.
 */
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePermission("dashboard:view");
  const visible = session ? ANALYTICS_TABS.filter((t) => can(session.role, t.permission)).map((t) => t.href) : [];
  return (
    <div className="grid gap-6">
      {visible.length > 1 && <AnalyticsTabs visible={visible} />}
      {children}
    </div>
  );
}
