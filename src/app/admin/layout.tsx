import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const NAV = [
  ["/admin", "Overview"],
  ["/admin/products", "Products"],
  ["/admin/batches", "Stock batches"],
  ["/admin/orders", "Orders"],
  ["/admin/stores", "Stores"],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The login page renders inside this layout too, so it must not redirect.
  const path = (await headers()).get("x-invoke-path") ?? "";
  const session = await requireAdmin();

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
          {NAV.map(([href, label]) => (
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
