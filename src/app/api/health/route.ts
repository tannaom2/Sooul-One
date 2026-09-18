import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Render's health check target (render.yaml healthCheckPath). */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "reachable" });
  } catch {
    // 503 rather than 200-with-a-warning, so the platform actually reacts.
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
