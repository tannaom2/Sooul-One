import { getProductsByBrand } from "@/server/catalog";
import { ProductGrid, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "The True Store — SooulOne",
  description: "Healthy namkeen, sweets and munchies, with the full nutrition panel on every page.",
};

export default async function TrueStore() {
  let products: Awaited<ReturnType<typeof getProductsByBrand>> = [];
  try {
    products = await getProductsByBrand("the-true-store");
  } catch {
    products = [];
  }

  return (
    <>
      <PageHeader
        title="The True Store"
        intro="Namkeen, sweets and munchies made to be read as well as eaten. Nutrition, allergens and best-before are on every product page."
      />
      <section className="mx-auto max-w-6xl px-5 py-12">
        {products.length > 0 ? (
          <ProductGrid products={products} />
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
