import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { NoAccess } from "@/components/ui";
import { CategoryForm } from "../category-form";

export const dynamic = "force-dynamic";

export default async function EditCategory({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("products:write");
  if (!session) return <NoAccess />;

  const { id } = await params;
  const category = await db.category.findUnique({
    where: { id },
    include: { brand: { select: { name: true } }, _count: { select: { products: true } } },
  });
  if (!category) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/categories" className="text-small text-ink-soft hover:underline">
          ← All categories
        </Link>
        <h1 className="mt-2 text-h2 font-extrabold">{category.name}</h1>
        <p className="mt-1 text-small text-ink-faint">
          {category.brand.name} · web address /{category.slug}
        </p>
      </div>
      <CategoryForm
        category={{
          id: category.id,
          name: category.name,
          description: category.description,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          productCount: category._count.products,
        }}
      />
    </div>
  );
}
