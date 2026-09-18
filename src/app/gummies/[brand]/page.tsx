import { notFound } from "next/navigation";
import { getBrandBySlug, getProductsByBrand } from "@/server/catalog";
import { ProductGrid, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACCENT: Record<string, string> = {
  "woman-axis": "var(--color-womanaxis)",
  "kids-vault": "var(--color-kidsvault)",
  "man-rituals": "var(--color-manrituals)",
};

export default async function BrandPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  if (!ACCENT[slug]) notFound();

  let brand = null;
  let products: Awaited<ReturnType<typeof getProductsByBrand>> = [];
  try {
    brand = await getBrandBySlug(slug);
    products = await getProductsByBrand(slug);
  } catch {
    /* unseeded database renders an empty brand rather than failing */
  }

  const name = brand?.name ?? slug.replace(/-/g, " ");

  return (
    <>
      <PageHeader
        title={name}
        intro={brand?.description ?? undefined}
        accent={ACCENT[slug]}
      />

      {brand?.categories && brand.categories.length > 0 && (
        <div className="border-b border-[--color-rule]">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-2 px-5 py-4 text-small">
            {brand.categories.map((c: { id: string; name: string }) => (
              <span key={c.id} className="text-ink-soft">
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <section className="mx-auto max-w-6xl px-5 py-12">
        {products.length > 0 ? (
          <ProductGrid products={products} />
        ) : (
          <Empty
            title={`Nothing listed under ${name} yet`}
            detail="Categories are set up and ready. Add products to this brand from the owner console."
          />
        )}
      </section>
    </>
  );
}
