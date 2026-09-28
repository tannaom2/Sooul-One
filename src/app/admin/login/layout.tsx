import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Already signed in (password and code both done): straight to the console.
 * Halfway through, with the password accepted but the code still to enter,
 * this lets the page through, since that session isn't signed in yet.
 */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  if (await requirePermission("dashboard:view")) redirect("/admin");
  return <>{children}</>;
}
