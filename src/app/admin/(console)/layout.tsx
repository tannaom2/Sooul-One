import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can, type Permission } from "@/lib/permissions";
import { AdminNav } from "./admin-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { CONSOLE_THEME_STORAGE_KEY } from "@/lib/theme";
import { CopilotDrawer } from "./copilot-drawer";
import { CommandMenu } from "./command-menu";

export const dynamic = "force-dynamic";

type NavItem = { href: string; label: string; permission: Permission };

// Grouped by the job being done, not by database table. Hiding a link is
// convenience only — each page and action enforces its own permission
// server-side, so a typed-in URL gets "no access", not the page.
const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [{ href: "/admin", label: "Overview", permission: "dashboard:view" }] },
  // Grouped by the job, not the table: packing and stock work sit together,
  // and the catalogue apart from it.
  {
    group: "Operations",
    items: [
      { href: "/admin/orders", label: "Orders", permission: "orders:view" },
      { href: "/admin/analytics/risk", label: "RTO risk", permission: "orders:view" },
      { href: "/admin/batches", label: "Stock batches", permission: "batches:write" },
      { href: "/admin/suppliers", label: "Suppliers", permission: "batches:write" },
      { href: "/admin/messages", label: "Messages", permission: "orders:view" },
    ],
  },
  {
    group: "Catalogue",
    items: [
      { href: "/admin/products", label: "Products", permission: "products:view" },
      { href: "/admin/categories", label: "Categories", permission: "products:write" },
      { href: "/admin/bundles", label: "Bundles", permission: "bundles:write" },
      { href: "/admin/boxes", label: "Boxes", permission: "bundles:write" },
      { href: "/admin/analytics/site", label: "Search terms", permission: "content:write" },
    ],
  },
  {
    group: "Customers",
    items: [
      { href: "/admin/enquiries", label: "Enquiries", permission: "enquiries:manage" },
      { href: "/admin/reviews", label: "Reviews", permission: "reviews:moderate" },
      { href: "/admin/referrals", label: "Referrals", permission: "settings:manage" },
      { href: "/admin/coupons", label: "Discount codes", permission: "products:pricing" },
    ],
  },
  {
    group: "Storefront",
    items: [
      { href: "/admin/brands", label: "Brands", permission: "settings:manage" },
      { href: "/admin/top-bar", label: "Top bar", permission: "settings:manage" },
      { href: "/admin/site-text", label: "Site text", permission: "settings:manage" },
      { href: "/admin/faqs", label: "FAQs", permission: "content:write" },
      { href: "/admin/articles", label: "Articles", permission: "content:write" },
      { href: "/admin/careers", label: "Careers", permission: "content:write" },
    ],
  },
  {
    group: "Insights",
    items: [
      { href: "/admin/analytics", label: "Analytics", permission: "finance:view" },
      { href: "/admin/funnel", label: "Funnel", permission: "finance:view" },
      { href: "/admin/reconciliation", label: "Reconciliation", permission: "finance:view" },
      { href: "/admin/activity/downloads", label: "Downloads", permission: "finance:view" },
    ],
  },
  {
    group: "Settings",
    items: [
      { href: "/admin/launch", label: "Launch checklist", permission: "settings:manage" },
      { href: "/admin/controls", label: "Store controls", permission: "settings:manage" },
      { href: "/admin/assistants", label: "Assistants", permission: "settings:manage" },
      { href: "/admin/business", label: "Business details", permission: "settings:manage" },
      { href: "/admin/stores", label: "Stores", permission: "stores:write" },
      { href: "/admin/team", label: "Team", permission: "team:manage" },
      { href: "/admin/activity", label: "Activity", permission: "audit:view" },
    ],
  },
];

/**
 * The console around every signed-in page. The sign-in and sign-out pages
 * sit outside this group, so when a session runs out mid-visit the sign-in
 * form replaces the whole console rather than appearing inside a sidebar
 * that still shows the old session.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Every active role has dashboard:view, so this is "signed in, active, and
  // MFA-verified" — with the role read fresh from the database.
  const session = await requirePermission("dashboard:view");
  if (!session) redirect("/admin/login");

  const groups = NAV.map((g) => ({
    group: g.group,
    items: g.items.filter((i) => can(session.role, i.permission)).map(({ href, label }) => ({ href, label })),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-rule bg-shelf print:hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <div className="px-5 pt-5 pb-3">
          <Link href="/admin" className="font-display text-h3 font-extrabold">
            SooulOne
          </Link>
          <p className="text-micro text-ink-faint">Owner console</p>
          {/* Ctrl+K: jump to a page or find a record (src/app/admin/(console)/command-menu.tsx). */}
          <div className="mt-3">
            <CommandMenu pages={groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })))} />
          </div>
          {/* The owner's AI copilot (docs/COPILOT.md): for people who can see the store's figures. */}
          {can(session.role, "finance:view") && (
            <div className="mt-3">
              <CopilotDrawer canAct={can(session.role, "settings:manage")} canConfigure={can(session.role, "settings:manage")} />
            </div>
          )}
        </div>

        <AdminNav groups={groups} />

        <div className="border-t border-rule px-5 py-4 text-micro text-ink-faint">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate" title={session.email}>
                {session.email}
              </p>
              <p className="mb-2">{session.role.toLowerCase()}</p>
            </div>
            {/* The console's own Day/Night choice; Store controls governs shoppers only. */}
            <ThemeToggle storageKey={CONSOLE_THEME_STORAGE_KEY} className="-mt-3 -mr-3 shrink-0 text-ink-soft" />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/admin/account" className="hover:text-ink hover:underline">
              Account security
            </Link>
            {/* A full page load: the storefront's header and basket come from the root
                layout, which an in-app navigation from here wouldn't redraw. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="hover:text-ink hover:underline">
              View store
            </a>
            <Link href="/admin/logout" className="hover:text-ink hover:underline">
              Sign out
            </Link>
          </div>
        </div>
      </aside>

      <div className="min-w-0 px-5 py-8 lg:px-10">{children}</div>
    </div>
  );
}
