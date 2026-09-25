import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { CategoryForm } from "./category-form";

export const dynamic = "force-dynamic";

export default async function AdminCategories() {
  const session = await requirePermission("products:write");
  if (!session) return <NoAccess />;

  let brands;
  try {
    brands = await db.brand.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        isActive: true,
        categories: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, isActive: true, sortOrder: true, _count: { select: { products: true } } },
        },
      },
    });
  } catch (error) {
    reportError("admin/categories", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Categories</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          The groups each brand&rsquo;s products are filtered by. Switching a category off takes its products off the
          shop and out of baskets; its order history stays. Names are checked like supplement copy, because products in
          a category may use its name in their own copy.
        </p>
      </div>

      <CategoryForm brands={brands.map((b) => ({ id: b.id, name: b.name }))} />

      {brands.map((brand) => (
        <section key={brand.id} className="panel">
          <div className="panel-head">
            {brand.name}
            {!brand.isActive && <span className="ml-2 text-micro font-semibold text-ink-faint">brand off</span>}
          </div>
          {brand.categories.length === 0 ? (
            <p className="p-3.5 text-small text-ink-faint">No categories yet.</p>
          ) : (
            brand.categories.map((c) => (
              <div key={c.id} className="panel-row">
                <span>
                  <strong>{c.name}</strong>
                  {!c.isActive && <span className="ml-2 text-micro font-semibold text-alert">off sale</span>}
                </span>
                <span className="flex items-center gap-4">
                  <span className="tabular text-ink-faint">
                    {c._count.products} product{c._count.products === 1 ? "" : "s"} · #{c.sortOrder}
                  </span>
                  <Link href={`/admin/categories/${c.id}`} className="underline">
                    Edit
                  </Link>
                </span>
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
