import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";
import { cronAuthorized } from "@/lib/cron-auth";
import { refreshBoxPool } from "@/server/boxes";

/**
 * Refresh every live box's pool from its sections' rules (src/server/boxes.ts),
 * daily: clearance sections depend on how close stock is to its shipping
 * cut-off and how fast it sells, which change every day. A box in a basket
 * whose product has left the pool asks the shopper to swap it.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ status: "not_configured", reason: "CRON_SECRET unset" }, { status: 503 });
  }
  if (!cronAuthorized(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  const boxes = await db.box.findMany({ where: { isActive: true }, select: { id: true } });
  const pools: Record<string, number> = {};
  for (const b of boxes) pools[b.id] = (await refreshBoxPool(b.id)).inPool;
  if (boxes.length > 0) expireTag(CATALOG_TAG);
  return NextResponse.json({ status: "ok", refreshed: boxes.length, pools });
}
