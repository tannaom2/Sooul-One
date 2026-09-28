export const dynamic = "force-dynamic";

// Never in search results, even if a link to it leaks.
export const metadata = { robots: { index: false, follow: false } };

/**
 * Everything under /admin. The console itself (sidebar, sign-in check) is
 * the (console) group's layout; sign-in and sign-out sit beside it.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
