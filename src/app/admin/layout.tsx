import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requirePermission } from "@/lib/auth";
import { can, type Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type NavItem = { href: string; label: string; permission: Permission };

// Grouped by the job being done, not by database table. Hiding a link is
// convenience only — each page and action enforces its own permission
// server-side, so a typed-in URL gets "no access", not the page.
const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [{ href: "/admin", label: "Overview", permission: "dashboard:view" }] },
  {
    group: "Sell",
    items: [
      { href: "/admin/orders", label: "Orders", permission: "orders:view" },
      { href: "/admin/products", label: "Products", permission: "products:view" },
      { href: "/admin/bundles", label: "Bundles", permission: "bundles:write" },
      { href: "/admin/coupons", label: "Discount codes", permission: "products:pricing" },
      { href: "/admin/batches", label: "Stock batches", permission: "batches:write" },
    ],
  },
  { group: "Engage", items: [{ href: "/admin/reviews", label: "Reviews", permission: "reviews:moderate" }] },
  {
    group: "Insights",
    items: [
      { href: "/admin/analytics", label: "Analytics", permission: "finance:view" },
      { href: "/admin/funnel", label: "Funnel", permission: "finance:view" },
      { href: "/admin/reconciliation", label: "Reconciliation", permission: "finance:view" },
    ],
  },
  {
    group: "Settings",
    items: [
      { href: "/admin/launch", label: "Launch checklist", permission: "settings:manage" },
      { href: "/admin/controls", label: "Store controls", permission: "settings:manage" },
      { href: "/admin/business", label: "Business details", permission: "settings:manage" },
      { href: "/admin/stores", label: "Stores", permission: "stores:write" },
      { href: "/admin/team", label: "Team", permission: "team:manage" },
      { href: "/admin/activity", label: "Activity", permission: "audit:view" },
    ],
  },
];

function isActive(path: string, href: string): boolean {
  return href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`);
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The login page renders inside this layout too, so it must not redirect.
  // proxy.ts always sets this from the real URL, so it can't be spoofed.
  const path = (await headers()).get("x-invoke-path") ?? "";
  // Every active role has dashboard:view, so this is "signed in, active, and
  // MFA-verified" — with the role read fresh from the database.
  const session = await requirePermission("dashboard:view");

  if (!session && !path.includes("/admin/login")) {
    redirect("/admin/login");
  }

  if (!session) return <>{children}</>;

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(session.role, i.permission)) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-[--color-rule] bg-shelf print:hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <div className="px-5 pt-5 pb-3">
          <Link href="/admin" className="font-display text-h3 font-extrabold">
            SooulOne
          </Link>
          <p className="text-micro text-ink-faint">Owner console</p>
        </div>

        <nav aria-label="Owner console" className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-4 lg:block lg:flex-1 lg:overflow-y-auto lg:px-3">
          {groups.map((g) => (
            <div key={g.group ?? "home"} className="lg:mb-4">
              {g.group && (
                <p className="hidden px-2 pb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase lg:block">
                  {g.group}
                </p>
              )}
              <ul className="flex flex-wrap gap-x-4 lg:block">
                {g.items.map((item) => {
                  const active = isActive(path, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`block py-1.5 text-small lg:px-2 ${
                          active ? "font-semibold text-ink lg:bg-paper" : "text-ink-soft hover:text-ink"
                        }`}
                        style={active ? { borderRadius: "var(--radius-panel)" } : undefined}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-[--color-rule] px-5 py-4 text-micro text-ink-faint">
          <p className="truncate" title={session.email}>
            {session.email}
          </p>
          <p className="mb-2">{session.role.toLowerCase()}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/admin/account" className="hover:text-ink hover:underline">
              Account security
            </Link>
            <Link href="/" className="hover:text-ink hover:underline">
              View store
            </Link>
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
