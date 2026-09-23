import { notFound } from "next/navigation";
import { getBrandBySlug, getProductsByBrand } from "@/server/catalog";
import { ProductGrid, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACCENT: Record<string, string> = {
  "woman-axis": "var(--color-womanaxis)",
  "kids-vault": "var(--color-kidsvault)",
  "man-rituals": "var(--color-manrituals)",
};

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  if (!ACCENT[slug]) return {};

  const brand = await getBrandBySlug(slug);
  const name = brand?.name ?? slug.replace(/-/g, " ");
  const description = brand?.description ?? `Daily gummies from ${name}, with full supplement facts and dosage guidance.`;

  return { title: `${name} — SooulOne Gummies`, description, openGraph: { title: name, description } };
}

export default async function BrandPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  if (!ACCENT[slug]) notFound();

  // A database error propagates to the nearest error.tsx rather than being
  // swallowed into "empty brand" — the two look identical to a shopper but
  // mean very different things to whoever has to notice and fix an outage.
  const brand = await getBrandBySlug(slug);
  const products = await getProductsByBrand(slug);

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
          <>
            <h2 className="sr-only">Products</h2>
            <ProductGrid products={products} />
          </>
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
