import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { decimalToPaise } from "@/lib/format";
import { BundleForm } from "./bundle-form";
import { BundleRowActions } from "./bundle-row-actions";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function BundlesPage() {
  const session = await requirePermission("bundles:write");
  if (!session) return <NoAccess />;

  let bundles: any[] = [];
  let brands: any[] = [];
  let products: any[] = [];
  try {
    [bundles, brands, products] = await Promise.all([
      db.bundle.findMany({
        include: { brand: { select: { name: true } }, eligibleProducts: { include: { product: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
      }),
      db.brand.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, brandId: true } }),
    ]);
  } catch {
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Bundles &amp; hampers</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          A live bundle discounts a basket the moment it has enough of the eligible products in it —
          no code change needed, and it takes effect at the next re-quote.
        </p>
      </div>

      <BundleForm brands={brands} products={products} />

      {bundles.length === 0 ? (
        <Empty title="No bundles yet" detail="Create one above to start combining products at a discount." />
      ) : (
        <div className="grid gap-3">
          {bundles.map((b) => (
            <div key={b.id} className="panel" style={{ opacity: b.isActive ? 1 : 0.6 }}>
              <div className="panel-head flex flex-wrap items-center justify-between gap-2">
                <span>
                  {b.name} <span className="text-micro font-normal text-ink-faint">· {b.brand.name}</span>
                </span>
                <span className="text-micro font-normal text-ink-faint">{b.isActive ? "Live" : "Inactive"}</span>
              </div>
              <div className="grid gap-3 p-3.5 sm:grid-cols-[1fr_auto]">
                <div className="text-small">
                  <p>
                    {b.discountType === "PERCENTAGE" ? `${Number(b.discountValue)}% off` : `${formatINR(decimalToPaise(b.discountValue))} off`}
                    {" · "}
                    minimum {b.minItems} distinct products
                    {b.maxItems ? ` · discounts up to ${b.maxItems}` : ""}
                  </p>
                  <p className="mt-1 text-ink-soft">
                    Eligible: {b.eligibleProducts.map((e: any) => e.product.name).join(", ")}
                  </p>
                </div>
                <BundleRowActions bundleId={b.id} isActive={b.isActive} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
