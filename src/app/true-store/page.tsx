import { getBrandBySlug, getProductsByBrand } from "@/server/catalog";
import { ConcernChips } from "@/components/concern-chips";
import { activeFilter, applyFilter, filterOptions } from "@/lib/concern-filter";
import { ProductGrid, Empty, PageHeader } from "@/components/ui";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "The True Store — SooulOne",
  description: "Healthy namkeen, sweets and munchies, with the full nutrition panel on every page.",
};

export default async function TrueStore({ searchParams }: { searchParams: Promise<{ concern?: string }> }) {
  const { concern } = await searchParams;
  let products: Awaited<ReturnType<typeof getProductsByBrand>> = [];
  let categories: { slug: string; name: string }[] = [];
  try {
    products = await getProductsByBrand("the-true-store");
    categories = (await getBrandBySlug("the-true-store"))?.categories ?? [];
  } catch (error) {
    reportError("true-store", error);
    products = [];
  }

  const options = filterOptions(categories, products);
  const active = activeFilter(concern, options);
  const shown = applyFilter(products, active);

  return (
    <>
      <PageHeader
        title="The True Store"
        intro="Namkeen, sweets and munchies made to be read as well as eaten. Nutrition, allergens and best-before are on every product page."
      />
      <ConcernChips
        label="Shop by category"
        basePath="/true-store"
        options={options}
        active={active}
        total={products.length}
        accent="var(--color-truestore)"
      />
      <section className="mx-auto max-w-6xl px-5 py-12">
        {products.length > 0 ? (
          <>
            {/* Visually hidden — keeps the heading hierarchy h1→h2→h3 intact
                (ProductCard uses h3) without adding a visible section title
                this page doesn't need. */}
            <h2 className="sr-only">Products</h2>
            <ProductGrid products={shown} />
          </>
        ) : (
          <Empty
            title="The shelf is empty"
            detail="Add packaged-food products from the owner console and they will appear here."
          />
        )}
      </section>
    </>
  );
}
