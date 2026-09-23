import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { Empty } from "@/components/ui";
import { ProductForm } from "../product-form";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return null;

  const { id } = await params;

  let product: any = null;
  let brands: any[] = [];
  try {
    [product, brands] = await Promise.all([
      db.product.findUnique({ where: { id }, include: { images: { orderBy: { sortOrder: "asc" } } } }),
      db.brand.findMany({
        where: { isActive: true },
        include: { categories: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
        orderBy: { name: "asc" },
      }),
    ]);
  } catch {
    // Distinct from "no such product": this is "can't tell if it exists,"
    // and treating the two the same way risks an admin deleting a product
    // that's actually fine, purely because the database blipped.
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and that migrations have run." />;
  }
  if (!product) notFound();

  return (
    <div>
      <h1 className="mb-6 text-h2 font-extrabold">{product.name}</h1>
      <ProductForm brands={brands} product={product} />
    </div>
  );
}
