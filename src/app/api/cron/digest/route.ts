import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { reportError } from "@/lib/observability";
import { digestEnabled, sendDigestNow } from "@/server/digest";

/**
 * The owner's daily summary (src/server/digest.ts), at 8 am India time
 * (render.yaml soulone-digest). One per day: running it twice sends nothing
 * new. Does nothing when the owner has switched it off.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ status: "not_configured", reason: "CRON_SECRET unset" }, { status: 503 });
  }
  if (!cronAuthorized(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  try {
    if (!(await digestEnabled())) return NextResponse.json({ status: "ok", digest: "off" });
    const [done] = await sendDigestNow();
    return NextResponse.json({ status: "ok", digest: done?.outcome.status ?? "already_sent" });
  } catch (error) {
    reportError("cron/digest", error);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
