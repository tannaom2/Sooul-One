import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findNearExpiryBatches } from "@/lib/compliance/fefo";
import { sendNearExpiryAlert } from "@/lib/email";
import { cronAuthorized } from "@/lib/cron-auth";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Scheduled trigger for the near-expiry owner alert (Section 7.6).
 *
 * The email itself has existed since phase 7; nothing called it on a timer.
 * This route is that timer's target — Render Cron Jobs (or any external
 * scheduler) hits it once a day. Protected by CRON_SECRET rather than
 * `requireAdmin`, because the caller is a cron job, not a logged-in browser.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ status: "not_configured", reason: "CRON_SECRET unset" }, { status: 503 });
  }

  if (!cronAuthorized(request.headers, secret)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const products = await db.product.findMany({
    where: { isActive: true },
    include: { batches: true },
  });

  const now = new Date();
  const nearExpiry = products.flatMap((p: any) => {
    if (!p.shelfLifeDays || !p.batches?.length) return [];
    return findNearExpiryBatches(
      p.batches.map((b: any) => ({
        id: b.id,
        batchNumber: b.batchNumber,
        expiresOn: new Date(b.expiresOn),
        quantityRemaining: b.quantityRemaining,
      })),
      p.shelfLifeDays,
      now,
      21,
    ).map((b) => ({ ...b, productName: p.name }));
  });

  const result = await sendNearExpiryAlert(nearExpiry);

  return NextResponse.json({
    status: "ok",
    batchesFlagged: nearExpiry.length,
    email: result,
  });
}
