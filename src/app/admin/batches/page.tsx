import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requiredRemainingDays, wholeDaysBetween } from "@/lib/compliance/shelf-life";
import { BatchForm } from "./batch-form";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function Batches() {
  const session = await requirePermission("batches:write");
  if (!session) return <NoAccess />;

  let products: any[] = [];
  try {
    products = await db.product.findMany({
      where: { isActive: true },
      include: { batches: { orderBy: { expiresOn: "asc" } } },
      orderBy: { name: "asc" },
    });
  } catch {
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  const now = new Date();

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="text-h2 font-extrabold">Receive stock</h1>
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
          <BatchForm products={products.map((p) => ({ id: p.id, name: p.name }))} />

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
                    <div key={b.id} className="panel-row">
                      <span>
                        {p.name} <span className="text-ink-faint">{b.batchNumber}</span>
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
