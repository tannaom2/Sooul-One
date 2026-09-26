import { getGummiesProducts } from "@/server/catalog";
import { ProductGrid, Empty, PageHeader } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { GummyBrandTabs } from "@/components/gummy-brand-tabs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Gummies — SooulOne",
  description: "Daily gummies from Woman Axis, Kids Vault and Man Rituals, with full supplement facts and dosage.",
};

export default async function Gummies() {
  let products: Awaited<ReturnType<typeof getGummiesProducts>> = [];
  try {
    products = await getGummiesProducts();
  } catch (error) {
    reportError("gummies", error);
    products = [];
  }

  return (
    <>
      <PageHeader
        title="Gummies"
        intro="Supplement facts, serving size and dosage guidance on every page. These support everyday nutrition; they are not medicines."
      />

      <GummyBrandTabs active={null} />

      <section className="mx-auto max-w-6xl px-5 py-12">

        {products.length > 0 ? (
          <>
            <h2 className="sr-only">Products</h2>
            <ProductGrid products={products} />
          </>
        ) : (
          <Empty
            title="No gummies listed yet"
            detail="Add health-supplement products from the owner console. Each one needs supplement facts, dosage guidance and a completed claims review before it can go live."
          />
        )}
      </section>
    </>
  );
}
