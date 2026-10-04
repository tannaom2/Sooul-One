import type { Permission } from "@/lib/permissions";

/**
 * Each report with the permission its page checks, so the bar offers only
 * what opens. RTO risk and Search and batches live under Orders and
 * Catalogue in the console's workspaces (src/lib/console-nav.ts), at the
 * same addresses, so they aren't repeated here.
 */
export const ANALYTICS_TABS: readonly { href: string; label: string; permission: Permission }[] = [
  { href: "/admin/analytics", label: "Overview", permission: "finance:view" },
  { href: "/admin/analytics/pincodes", label: "Pincodes", permission: "finance:view" },
  { href: "/admin/analytics/payments", label: "Payments", permission: "finance:view" },
  { href: "/admin/analytics/customers", label: "Customers", permission: "finance:view" },
  { href: "/admin/analytics/campaigns", label: "Campaigns", permission: "finance:view" },
];
