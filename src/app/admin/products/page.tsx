import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { Empty, VegMark } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { decimalToPaise } from "@/lib/format";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AdminProducts() {
  const session = await requireAdmin();
  if (!session) return null;

  let products: any[] = [];
  try {
    products = await db.product.findMany({
      include: { brand: true, category: true },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-h2 font-extrabold">Products</h1>
        <Link href="/admin/products/new" className="btn btn-solid">Add a product</Link>
      </div>

      {products.length === 0 ? (
        <Empty
          title="No products yet"
          detail="Add your first one. The form asks for different label information depending on whether it's a packaged food or a supplement."
          action={<Link href="/admin/products/new" className="btn btn-solid">Add a product</Link>}
        />
      ) : (
        <div className="panel">
          {products.map((p) => (
            <div key={p.id} className="panel-row items-center">
              <span className="flex items-center gap-3">
                <VegMark isVeg={p.isVeg} />
                <span>
                  <Link href={`/admin/products/${p.id}`} className="font-semibold hover:underline">
                    {p.name}
                  </Link>
                  <span className="ml-2 text-ink-faint">
                    {p.brand?.name} / {p.category?.name}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-4">
                {p.regulatoryType === "HEALTH_SUPPLEMENT" && !p.complianceReviewedAt && (
                  <span className="text-micro font-semibold" style={{ color: "var(--color-caution)" }}>
                    claims review pending
                  </span>
                )}
                {!p.isActive && <span className="text-micro text-ink-faint">draft</span>}
                <span className="tabular">{formatINR(decimalToPaise(p.basePrice))}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
