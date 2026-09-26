import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Empty, NoAccess, VegMark } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { stockView } from "@/lib/stock-view";
import { decimalToPaise } from "@/lib/format";
import {
  PRODUCT_VIEWS,
  PRODUCTS_PAGE_SIZE,
  parseProductFilters,
  productFiltersHref,
  type ProductView,
} from "@/lib/product-filters";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

function viewWhere(view: ProductView): Prisma.ProductWhereInput {
  switch (view) {
    case "live":
      return { isActive: true };
    case "draft":
      return { isActive: false };
    case "low":
      return { stockQuantity: { gt: 0, lte: db.product.fields.lowStockThreshold } };
    case "out":
      return { stockQuantity: { lte: 0 } };
    case "review":
      return { regulatoryType: "HEALTH_SUPPLEMENT", complianceReviewedAt: null };
    default:
      return {};
  }
}

export default async function AdminProducts({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; brand?: string; page?: string }>;
}) {
  const session = await requirePermission("products:view");
  if (!session) return <NoAccess />;
  // Creating a product sets its price, so it needs pricing rights too.
  const canCreate = can(session.role, "products:write") && can(session.role, "products:pricing");

  let brands: { id: string; name: string }[] = [];
  let products: any[] = [];
  let total = 0;
  let counts: number[] = [];
  let hasAny = true;
  const views = Object.keys(PRODUCT_VIEWS) as ProductView[];

  const raw = await searchParams;
  let filters = parseProductFilters(raw, []);
  try {
    brands = await db.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
    filters = parseProductFilters(raw, brands.map((b) => b.id));

    const base: Prisma.ProductWhereInput = {
      ...(filters.brand && { brandId: filters.brand }),
      ...(filters.q && {
        OR: [
          { name: { contains: filters.q, mode: "insensitive" } },
          { sku: { contains: filters.q, mode: "insensitive" } },
        ],
      }),
    };
    const where = { ...base, ...viewWhere(filters.view) };

    [products, total, counts, hasAny] = await Promise.all([
      db.product.findMany({
        where,
        include: { brand: true, category: true, batches: { where: { quantityRemaining: { gt: 0 } } } },
        orderBy: { createdAt: "desc" },
        take: PRODUCTS_PAGE_SIZE,
        skip: (filters.page - 1) * PRODUCTS_PAGE_SIZE,
      }),
      db.product.count({ where }),
      // Tab counts respect the search and brand, like the orders tabs.
      Promise.all(views.map((v) => db.product.count({ where: { ...base, ...viewWhere(v) } }))),
      db.product.count().then((n) => n > 0),
    ]);
  } catch (error) {
    reportError("admin/products", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  const { view, q, brand, page } = filters;
  const pages = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));
  const addButton = canCreate && (
    <Link href="/admin/products/new" className="btn btn-solid">
      Add a product
    </Link>
  );

  if (!hasAny) {
    return (
      <div>
        <h1 className="mb-6 text-h2 font-extrabold">Products</h1>
        <Empty
          title="No products yet"
          detail="Add your first one. The form asks for different label information depending on whether it's a packaged food or a supplement."
          action={addButton || undefined}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h2 font-extrabold">Products</h1>
        {addButton}
      </div>

      <form method="get" role="search" className="flex flex-wrap items-center gap-2">
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        <label htmlFor="product-search" className="sr-only">
          Search products
        </label>
        <input
          id="product-search"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          placeholder="Name or SKU…"
          className="field min-w-0 flex-1 sm:w-64 sm:flex-none"
        />
        {brands.length > 1 && (
          <>
            <label htmlFor="product-brand" className="sr-only">
              Brand
            </label>
            <select id="product-brand" name="brand" defaultValue={brand ?? ""} className="field w-auto">
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </>
        )}
        <button className="btn btn-outline px-4 py-2 text-small">Search</button>
        {(q || brand) && (
          <Link href={productFiltersHref({ view })} className="text-small underline">
            Clear
          </Link>
        )}
      </form>

      <nav aria-label="Filter products" className="-mx-1 flex gap-1 overflow-x-auto border-b border-rule pb-px">
        {views.map((v, i) => {
          const active = v === view;
          return (
            <Link
              key={v}
              href={productFiltersHref({ view: v, q, brand })}
              aria-current={active ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-small whitespace-nowrap ${
                active ? "border-ink font-semibold" : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {PRODUCT_VIEWS[v]} <span className="tabular text-ink-faint">{counts[i]}</span>
            </Link>
          );
        })}
      </nav>

      {products.length === 0 ? (
        <Empty title="No matching products" detail="Try another search, brand or tab." />
      ) : (
        <div className="panel">
          {products.map((p) => {
            // Shippable stock, by the storefront's rule: short-dated units don't count.
            const stock = stockView(p);
            const out = stock.shippable <= 0;
            const low = !out && stock.low;
            return (
              <div key={p.id} className="panel-row items-center gap-3">
                <span className="flex min-w-0 items-center gap-3">
                  <VegMark isVeg={p.isVeg} />
                  <span className="min-w-0">
                    <Link href={`/admin/products/${p.id}`} className="font-semibold hover:underline">
                      {p.name}
                    </Link>
                    <span className="ml-2 text-ink-faint">
                      {p.brand?.name} / {p.category?.name}
                    </span>
                    <span className="ml-2 text-micro text-ink-faint tabular">{p.sku}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-1">
                  {p.regulatoryType === "HEALTH_SUPPLEMENT" && !p.complianceReviewedAt && (
                    <span className="text-micro font-semibold" style={{ color: "var(--color-caution)" }}>
                      claims review pending
                    </span>
                  )}
                  {!p.isActive && <span className="text-micro text-ink-faint">draft</span>}
                  <span
                    className={`text-micro tabular ${out ? "font-semibold text-alert" : low ? "font-semibold" : "text-ink-faint"}`}
                    style={low ? { color: "var(--color-caution)" } : undefined}
                  >
                    {out ? (stock.held > 0 ? "none shippable" : "out of stock") : `${stock.shippable} shippable`}
                    {stock.tooShortDated > 0 && ` · ${stock.tooShortDated} too short-dated`}
                  </span>
                  <span className="tabular">{formatINR(decimalToPaise(p.basePrice))}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-4 text-small">
          {page > 1 && (
            <Link href={productFiltersHref({ ...filters, page: page - 1 })} className="underline">
              Newer
            </Link>
          )}
          <span className="tabular text-ink-faint">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={productFiltersHref({ ...filters, page: page + 1 })} className="underline">
              Older
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
