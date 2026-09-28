import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { runReferralJobs } from "@/server/referrals";

/**
 * Pay referral rewards whose return window has passed, and expire sign-ups
 * that never ordered (src/server/referrals.ts). Run daily by a cron job;
 * each reward is paid in its own transaction, guarded by the per-referrer
 * cap and the monthly budget, so running it twice pays nothing twice.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ status: "not_configured", reason: "CRON_SECRET unset" }, { status: 503 });
  }
  if (!cronAuthorized(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  const result = await runReferralJobs();
  return NextResponse.json({ status: "ok", ...result });
}
