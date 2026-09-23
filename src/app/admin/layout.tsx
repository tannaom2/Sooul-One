import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requirePermission } from "@/lib/auth";
import { can, type Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// Hiding a link is convenience only — each page and action enforces its own
// permission server-side, so a typed-in URL gets "no access", not the page.
const NAV: [string, string, Permission][] = [
  ["/admin", "Overview", "dashboard:view"],
  ["/admin/products", "Products", "products:view"],
  ["/admin/bundles", "Bundles", "bundles:write"],
  ["/admin/batches", "Stock batches", "batches:write"],
  ["/admin/orders", "Orders", "orders:view"],
  ["/admin/reviews", "Reviews", "reviews:moderate"],
  ["/admin/analytics", "Analytics", "finance:view"],
  ["/admin/funnel", "Funnel", "finance:view"],
  ["/admin/reconciliation", "Reconciliation", "finance:view"],
  ["/admin/stores", "Stores", "stores:write"],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The login page renders inside this layout too, so it must not redirect.
  const path = (await headers()).get("x-invoke-path") ?? "";
  // Every active role has dashboard:view, so this is "signed in, active, and
  // MFA-verified" — with the role read fresh from the database.
  const session = await requirePermission("dashboard:view");

  if (!session && !path.includes("/admin/login")) {
    // Server-side verification is the real gate; middleware only bounces
    // obviously anonymous traffic.
    redirect("/admin/login");
  }

  if (!session) return <>{children}</>;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-[--color-rule] pb-4">
        <div>
          <p className="font-display text-h3 font-extrabold">Owner console</p>
          <p className="text-micro text-ink-faint">
            Signed in as {session.email} ({session.role.toLowerCase()})
          </p>
        </div>
        <nav className="flex flex-wrap gap-4 text-small font-medium">
          {NAV.filter(([, , permission]) => can(session.role, permission)).map(([href, label]) => (
            <Link key={href} href={href} className="hover:underline">
              {label}
            </Link>
          ))}
          <Link href="/admin/logout" className="text-ink-faint hover:underline">
            Sign out
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
