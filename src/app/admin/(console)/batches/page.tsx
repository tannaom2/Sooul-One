import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requiredRemainingDays, wholeDaysBetween } from "@/lib/compliance/shelf-life";
import { BatchForm } from "./batch-form";
import { RecallControl } from "./recall-control";
import { normalizeBatch } from "@/lib/batch-verify";
import { reportError } from "@/lib/observability";
import Link from "next/link";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function Batches() {
  const session = await requirePermission("batches:write");
  if (!session) return <NoAccess />;

  let products: any[] = [];
  let suppliers: { id: string; name: string }[] = [];
  // How often shoppers checked each batch on /verify in the last 90 days, by normalised code.
  let checks = new Map<string, number>();
  try {
    const counted = await db.$queryRaw<{ batch: string; n: bigint }[]>`
      SELECT metadata->>'batch' AS batch, count(*) AS n FROM "AnalyticsEvent"
      WHERE type = 'BATCH_CHECKED' AND "createdAt" > now() - interval '90 days' AND (metadata->>'found')::boolean
      GROUP BY 1`;
    checks = new Map(counted.map((c) => [c.batch, Number(c.n)]));
    [products, suppliers] = await Promise.all([
      db.product.findMany({
        where: { isActive: true },
        include: { batches: { orderBy: { expiresOn: "asc" }, include: { supplier: { select: { name: true } } } } },
        orderBy: { name: "asc" },
      }),
      db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);
  } catch (error) {
    reportError("admin/batches", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  const now = new Date();

  return (
    <div className="grid gap-10">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-h2 font-extrabold">Receive stock</h1>
          {/* No customer data, so no authenticator step (src/app/admin/(console)/batches/export/route.ts). */}
          <span className="flex gap-4 text-small">
            <a href="/admin/batches/export" className="underline">Download stock (CSV)</a>
            <a href="/admin/batches/export?all=1" className="text-ink-soft underline">All batches</a>
          </span>
        </div>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          Record every delivery as a batch with its own manufacture and expiry dates. That is what
          lets the site send the oldest still-compliant stock first, and what answers
          &ldquo;who received batch X&rdquo; if anything ever has to be recalled.
        </p>
      </div>

      {products.length === 0 ? (
        <Empty title="No products yet" detail="Add a product before receiving stock against it." />
      ) : (
        <>
          <BatchForm
            products={products.map((p) => ({ id: p.id, name: p.name, manufacturerId: p.manufacturerId ?? null }))}
            suppliers={suppliers}
            today={new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10)}
          />

          <section>
            <h2 className="mb-3 text-h3 font-bold">Current batches</h2>
            <div className="panel">
              <div className="panel-row font-semibold">
                <span>Product / batch</span>
                <span>Remaining · shippable until</span>
              </div>
              {products.flatMap((p) =>
                (p.batches ?? []).map((b: any) => {
                  const required = p.shelfLifeDays ? requiredRemainingDays(p.shelfLifeDays) : 0;
                  const daysLeft = wholeDaysBetween(now, new Date(b.expiresOn));
                  const headroom = daysLeft - required;

                  return (
                    <div key={b.id} className="panel-row flex-wrap">
                      <span className="grid gap-1">
                        <span>
                          {p.name} <span className="text-ink-faint">{b.batchNumber}</span>
                          {checks.get(normalizeBatch(b.batchNumber)) ? (
                            <span className="ml-2 text-micro text-ink-soft">checked {checks.get(normalizeBatch(b.batchNumber))}× on /verify</span>
                          ) : null}
                        </span>
                        <span className="text-micro text-ink-faint">
                          {b.supplier ? `From ${b.supplier.name}` : "Supplier not recorded"}
                          {b.invoiceNumber ? ` · invoice ${b.invoiceNumber}` : ""}
                          {/* The recall list: who received it, with contact details (owner and manager). */}
                          {can(session.role, "recalls:manage") && (
                            <>
                              {" · "}
                              <Link href={`/admin/batches/${b.id}`} className="underline">
                                Who received it
                              </Link>
                            </>
                          )}
                        </span>
                        <RecallControl batchId={b.id} batchNumber={b.batchNumber} recalled={Boolean(b.recalledAt)} note={b.recallNote} />
                      </span>
                      <span className="tabular">
                        {b.quantityRemaining}
                        <span
                          className="ml-3"
                          style={{
                            color:
                              headroom <= 0
                                ? "var(--color-alert)"
                                : headroom <= 21
                                  ? "var(--color-caution)"
                                  : "var(--color-ink-faint)",
                          }}
                        >
                          {headroom <= 0 ? "not shippable" : `${headroom} days`}
                        </span>
                        <span className="ml-3 text-ink-faint">exp {formatDate(b.expiresOn)}</span>
                      </span>
                    </div>
                  );
                }),
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
