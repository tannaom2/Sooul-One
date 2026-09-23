import Link from "next/link";
import { getGummiesProducts } from "@/server/catalog";
import { ProductGrid, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Gummies — SooulOne",
  description: "Daily gummies from Woman Axis, Kids Vault and Man Rituals, with full supplement facts and dosage.",
};

const BRANDS = [
  { slug: "woman-axis", name: "Woman Axis", accent: "var(--color-womanaxis)" },
  { slug: "kids-vault", name: "Kids Vault", accent: "var(--color-kidsvault)" },
  { slug: "man-rituals", name: "Man Rituals", accent: "var(--color-manrituals)" },
];

export default async function Gummies() {
  let products: Awaited<ReturnType<typeof getGummiesProducts>> = [];
  try {
    products = await getGummiesProducts();
  } catch {
    products = [];
  }

  return (
    <>
      <PageHeader
        title="Gummies"
        intro="Supplement facts, serving size and dosage guidance on every page. These support everyday nutrition; they are not medicines."
      />

      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="mb-10 flex flex-wrap gap-3">
          {BRANDS.map((b) => (
            <Link
              key={b.slug}
              href={`/gummies/${b.slug}`}
              className="btn btn-outline"
              style={{ borderColor: b.accent, color: b.accent }}
            >
              {b.name}
            </Link>
          ))}
        </div>

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
