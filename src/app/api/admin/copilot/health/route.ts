import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { copilotStatus } from "@/server/copilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is the owner's local copilot reachable? For the Online / Offline dot in the console. */
export async function GET() {
  const session = await requirePermission("finance:view");
  if (!session) return NextResponse.json({ message: "Sign in again." }, { status: 401 });
  return NextResponse.json(await copilotStatus(), { headers: { "Cache-Control": "no-store" } });
}
