import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { Suspense } from "react";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { visibleWorkspaces } from "@/lib/console-nav";
import { reportError } from "@/lib/observability";
import { AdminNav, WorkspaceTabs, type NavWorkspace } from "./admin-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { CONSOLE_THEME_STORAGE_KEY } from "@/lib/theme";
import { CopilotDrawer } from "./copilot-drawer";
import { CommandMenu } from "./command-menu";

export const dynamic = "force-dynamic";

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

  // Seven workspaces and Settings (src/lib/console-nav.ts), trimmed to this role.
  const { workspaces, settings } = visibleWorkspaces(session.role);
  // What's waiting in each, for the sidebar's counts. Cheap counts only; a
  // database hiccup shows no counts rather than no console.
  const role = session.role;
  const badges: Record<string, number> = {};
  try {
    const [toPack, enquiries, reviews, unlicensed] = await Promise.all([
      can(role, "orders:view") ? db.order.count({ where: { status: { in: ["PAID", "PROCESSING"] } } }) : 0,
      can(role, "enquiries:manage") ? db.enquiry.count({ where: { status: "NEW" } }) : 0,
      can(role, "reviews:moderate") ? db.review.count({ where: { isApproved: false } }) : 0,
      can(role, "batches:write") ? db.supplier.count({ where: { isActive: true, fssaiLicence: null, OR: [{ manufactured: { some: { isActive: true } } }, { marketed: { some: { isActive: true } } }] } }) : 0,
    ]);
    Object.assign(badges, { orders: toPack, customers: enquiries + reviews, stock: unlicensed });
  } catch (error) {
    reportError("console/badges", error);
  }
  const nav = (w: { id: string; label: string; tabs: readonly { href: string }[] }): NavWorkspace => ({ id: w.id, label: w.label, href: w.tabs[0].href, badge: badges[w.id] ?? 0 });

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
            <CommandMenu pages={[...workspaces, ...(settings ? [settings] : [])].flatMap((w) => w.tabs.map((t) => ({ href: t.href, label: t.label, group: w.label })))} />
          </div>
          {/* The owner's AI copilot (docs/COPILOT.md): for people who can see the store's figures. */}
          {can(session.role, "finance:view") && (
            <div className="mt-3">
              <CopilotDrawer canAct={can(session.role, "settings:manage")} canConfigure={can(session.role, "settings:manage")} />
            </div>
          )}
        </div>

        <Suspense fallback={null}>
          <AdminNav workspaces={workspaces.map(nav)} settings={settings ? nav(settings) : null} />
        </Suspense>

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

      <div className="min-w-0 px-5 py-8 lg:px-10">
        <Suspense fallback={null}>
          <WorkspaceTabs workspaces={[...workspaces, ...(settings ? [settings] : [])]} />
        </Suspense>
        {children}
      </div>
    </div>
  );
}
