import { NextResponse } from "next/server";
import { audit, requirePermission } from "@/lib/auth";
import { recipientsCsv } from "@/lib/recall";
import { loadRecall } from "@/server/recall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everyone who received a batch, as a spreadsheet, for working through a
 * recall by phone. Personal data, so owner and manager only (recalls:manage),
 * and every download is in Activity. No authenticator step: in a recall,
 * minutes matter.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("recalls:manage");
  if (!session) return NextResponse.json({ message: "Your role can't download recall lists." }, { status: 403 });
  const { id } = await params;
  const loaded = await loadRecall(id);
  if (!loaded) return NextResponse.json({ message: "That batch no longer exists." }, { status: 404 });
  const { batch, rows } = loaded;
  await audit(session, "EXPORT_RECALL_LIST", "ProductBatch", id, { product: batch.product.name, batch: batch.batchNumber, rows: rows.length });
  const safe = `${batch.product.name}-${batch.batchNumber}`.replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 60);
  return new NextResponse(recipientsCsv(rows, { product: batch.product.name, batchNumber: batch.batchNumber }), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="recall-${safe}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
