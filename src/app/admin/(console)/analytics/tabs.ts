import type { Permission } from "@/lib/permissions";

/** Each report with the permission its page checks, so the bar offers only what opens. */
export const ANALYTICS_TABS: readonly { href: string; label: string; permission: Permission }[] = [
  { href: "/admin/analytics", label: "Overview", permission: "finance:view" },
  { href: "/admin/analytics/pincodes", label: "Pincodes", permission: "finance:view" },
  { href: "/admin/analytics/payments", label: "Payments", permission: "finance:view" },
  { href: "/admin/analytics/customers", label: "Customers", permission: "finance:view" },
  { href: "/admin/analytics/campaigns", label: "Campaigns", permission: "finance:view" },
  { href: "/admin/analytics/risk", label: "RTO risk", permission: "orders:view" },
  { href: "/admin/analytics/site", label: "Search and batches", permission: "content:write" },
];
