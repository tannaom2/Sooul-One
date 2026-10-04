import { can, type AdminRole, type Permission } from "@/lib/permissions";

/**
 * The console's shell (omni-channel report, "restructure the shell, not the
 * engine"): seven workspaces in the sidebar, each a row of tabs over pages
 * that already exist, at the addresses they already have. Settings sits at
 * the foot of the sidebar. Pure, so the map is tested
 * (tests/console-nav.test.ts): every old link must still be reachable.
 *
 * Hiding a tab is convenience only: every page and action checks its own
 * permission on the server.
 */

export interface ConsoleTab {
  readonly href: string;
  readonly label: string;
  readonly permission: Permission;
  /** Also active on these paths (prefixes), e.g. an order's own page under Orders. */
  readonly alsoOn?: readonly string[];
}

export interface Workspace {
  readonly id: string;
  readonly label: string;
  readonly tabs: readonly ConsoleTab[];
}

export const WORKSPACES: readonly Workspace[] = [
  { id: "today", label: "Today", tabs: [{ href: "/admin", label: "Today", permission: "dashboard:view" }] },
  {
    id: "orders",
    label: "Orders",
    tabs: [
      { href: "/admin/orders", label: "Orders", permission: "orders:view" },
      { href: "/admin/orders/packing", label: "Packing", permission: "orders:view" },
      { href: "/admin/orders?view=returned", label: "Returns", permission: "orders:view" },
      { href: "/admin/analytics/risk", label: "RTO risk", permission: "orders:view" },
      { href: "/admin/messages", label: "Emails", permission: "orders:view" },
    ],
  },
  {
    id: "stock",
    label: "Stock",
    tabs: [
      { href: "/admin/batches", label: "Batches", permission: "batches:write" },
      { href: "/admin/suppliers", label: "Suppliers", permission: "batches:write" },
    ],
  },
  {
    id: "catalogue",
    label: "Catalogue",
    tabs: [
      { href: "/admin/products", label: "Products", permission: "products:view" },
      { href: "/admin/categories", label: "Categories", permission: "products:write" },
      { href: "/admin/bundles", label: "Bundles", permission: "bundles:write" },
      { href: "/admin/boxes", label: "Boxes", permission: "bundles:write" },
      { href: "/admin/analytics/site", label: "Search terms", permission: "content:write" },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    tabs: [
      { href: "/admin/enquiries", label: "Enquiries", permission: "enquiries:manage" },
      { href: "/admin/reviews", label: "Reviews", permission: "reviews:moderate" },
      { href: "/admin/referrals", label: "Referrals", permission: "settings:manage" },
      { href: "/admin/coupons", label: "Discount codes", permission: "products:pricing" },
    ],
  },
  {
    id: "storefront",
    label: "Storefront",
    tabs: [
      { href: "/admin/brands", label: "Brands", permission: "settings:manage" },
      { href: "/admin/top-bar", label: "Top bar", permission: "settings:manage" },
      { href: "/admin/site-text", label: "Site text", permission: "settings:manage" },
      { href: "/admin/faqs", label: "FAQs", permission: "content:write" },
      { href: "/admin/articles", label: "Articles", permission: "content:write" },
      { href: "/admin/careers", label: "Careers", permission: "content:write" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    tabs: [
      { href: "/admin/analytics", label: "Analytics", permission: "finance:view" },
      { href: "/admin/funnel", label: "Funnel", permission: "finance:view" },
      { href: "/admin/reconciliation", label: "Reconciliation", permission: "finance:view" },
      { href: "/admin/activity/downloads", label: "Downloads", permission: "finance:view", alsoOn: ["/admin/activity/export"] },
    ],
  },
];

export const SETTINGS: Workspace = {
  id: "settings",
  label: "Settings",
  tabs: [
    { href: "/admin/launch", label: "Launch checklist", permission: "settings:manage" },
    { href: "/admin/controls", label: "Store controls", permission: "settings:manage" },
    { href: "/admin/business", label: "Business details", permission: "settings:manage" },
    { href: "/admin/stores", label: "Stores", permission: "stores:write" },
    { href: "/admin/team", label: "Team", permission: "team:manage" },
    { href: "/admin/assistants", label: "Assistants", permission: "settings:manage" },
    { href: "/admin/activity", label: "Activity", permission: "audit:view" },
  ],
};

const ALL = [...WORKSPACES, SETTINGS];

/** The workspaces and tabs this role can open; a workspace with none is left out. */
export function visibleWorkspaces(role: AdminRole): { workspaces: Workspace[]; settings: Workspace | null } {
  const trim = (w: Workspace): Workspace => ({ ...w, tabs: w.tabs.filter((t) => can(role, t.permission)) });
  const workspaces = WORKSPACES.map(trim).filter((w) => w.tabs.length > 0);
  const settings = trim(SETTINGS);
  return { workspaces, settings: settings.tabs.length > 0 ? settings : null };
}

const pathOf = (href: string) => href.split("?")[0];
const queryOf = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

/** How well a tab matches the address: -1 for not at all, else longer is better. */
function score(tab: ConsoleTab, pathname: string, search: URLSearchParams): number {
  const prefixes = [pathOf(tab.href), ...(tab.alsoOn ?? [])];
  let best = -1;
  for (const prefix of prefixes) {
    const exact = pathname === prefix;
    // "/admin" only matches itself, never every console page.
    const under = prefix !== "/admin" && pathname.startsWith(`${prefix}/`);
    if (!exact && !under) continue;
    let s = prefix.length * 10 + (exact ? 5 : 0);
    // A tab defined by a query ("?view=returned") wins only when the address has it.
    const wanted = queryOf(tab.href);
    let fits = true;
    for (const [k, v] of wanted) if (search.get(k) !== v) fits = false;
    if (!fits) continue;
    s += [...wanted].length * 2;
    best = Math.max(best, s);
  }
  return best;
}

/** The workspace and tab an address belongs to, or null (a page outside the shell, like Account security). */
export function locate(pathname: string, search: URLSearchParams | string = ""): { workspace: string; tab: string } | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  let found: { workspace: string; tab: string; score: number } | null = null;
  for (const w of ALL) {
    for (const t of w.tabs) {
      const s = score(t, pathname, params);
      if (s >= 0 && (!found || s > found.score)) found = { workspace: w.id, tab: t.href, score: s };
    }
  }
  return found ? { workspace: found.workspace, tab: found.tab } : null;
}
