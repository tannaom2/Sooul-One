import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { ProductForm } from "../product-form";
import { Empty, NoAccess } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewProduct() {
  const session = await requirePermission("products:write");
  if (!session) return <NoAccess />;

  let brands: any[] = [];
  try {
    brands = await db.brand.findMany({
      where: { isActive: true },
      include: { categories: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    });
  } catch {
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  if (brands.length === 0) {
    return (
      <Empty
        title="No brands set up yet"
        detail="Run `npm run db:seed` to create the brands and their categories, then come back here."
      />
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-h2 font-extrabold">Add a product</h1>
      <ProductForm brands={brands} />
    </div>
  );
}
