import Link from "next/link";
import { getBrands, getFeatured } from "@/server/catalog";
import { ProductGrid, Empty } from "@/components/ui";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

const GUMMIES = [
  { slug: "woman-axis", name: "Woman Axis", line: "Daily vitamins through to sleep, stress and PMS support.", accent: "var(--color-womanaxis)" },
  { slug: "kids-vault", name: "Kids Vault", line: "Multivitamin, immunity, eye care, focus and calcium for children.", accent: "var(--color-kidsvault)" },
  { slug: "man-rituals", name: "Man Rituals", line: "Vitality, multivitamin and hair support for men.", accent: "var(--color-manrituals)" },
];

export default async function Home() {
  // The catalogue may be empty before the owner has added anything. Failing
  // softly here matters: a database that is merely unseeded should render the
  // site, not a stack trace.
  let featured: Awaited<ReturnType<typeof getFeatured>> = [];
  let brandCount = 0;
  try {
    featured = await getFeatured();
    brandCount = (await getBrands()).length;
  } catch (error) {
    reportError("home", error);
    featured = [];
  }

  return (
    <>
      {/* HERO — the most characteristic thing in this brief is the label
          itself, so the hero is a label, not a lifestyle photograph. */}
      <section className="border-b border-[--color-rule]">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
          <div>
            <h1 className="max-w-[16ch] text-hero font-extrabold">
              Read the label first. That&rsquo;s the point.
            </h1>
            <p className="mt-5 max-w-[52ch] text-lead text-ink-soft">
              Namkeen, sweets and snacks from The True Store, and daily gummies from Woman Axis,
              Kids Vault and Man Rituals. Every nutrient figure, allergen and dosage is on the
              product page before you add anything to your basket.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/true-store" className="btn btn-solid">
                Shop The True Store
              </Link>
              <Link href="/gummies" className="btn btn-outline">
                Shop gummies
              </Link>
            </div>
          </div>

          {/* A real statutory-style panel as the hero visual. */}
          <div className="panel self-start">
            <div className="panel-head flex items-center justify-between">
              <span>Nutrition per 30 g</span>
              <span className="mark mark-veg" role="img" aria-label="Vegetarian" />
            </div>
            <dl>
              {[
                ["Energy", "123 kcal"],
                ["Protein", "5.7 g"],
                ["Carbohydrate", "15.6 g"],
                ["of which sugars", "0.9 g"],
                ["Total fat", "3.6 g"],
                ["of which saturates", "0.6 g"],
                ["Trans fat", "0 g"],
                ["Dietary fibre", "4.5 g"],
                ["Sodium", "144 mg"],
              ].map(([k, v]) => (
                <div className="panel-row" key={k}>
                  <dt className={k.startsWith("of which") ? "pl-4 text-ink-soft" : ""}>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="px-3.5 py-2.5 text-micro text-ink-faint">
              Illustrative panel. Live products show their own declared figures.
            </p>
          </div>
        </div>
      </section>

      {/* BRANDS */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-h2 font-extrabold">Four brands, two regulatory regimes</h2>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          Snacks are packaged food. Gummies are health supplements. They are labelled differently
          because the law treats them differently, and we show you which is which.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            href="/true-store"
            className="flex flex-col justify-between gap-6 border border-[--color-rule] p-6 hover:border-ink"
            style={{ background: "color-mix(in srgb, var(--color-truestore) 10%, white)" }}
          >
            <div>
              <h3 className="text-h3 font-bold" style={{ color: "#9a6a05" }}>
                The True Store
              </h3>
              <p className="mt-2 max-w-[42ch] text-small text-ink-soft">
                Healthy namkeen, sweets and munchies, plus gift hampers. Also stocked in our
                superstores.
              </p>
            </div>
            <span className="text-small font-semibold underline">Browse the shelf</span>
          </Link>

          <div className="grid gap-4">
            {GUMMIES.map((b) => (
              <Link
                key={b.slug}
                href={`/gummies/${b.slug}`}
                className="border border-[--color-rule] p-5 hover:border-ink"
              >
                <h3 className="text-h3 font-bold" style={{ color: b.accent }}>
                  {b.name}
                </h3>
                <p className="mt-1 max-w-[46ch] text-small text-ink-soft">{b.line}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURED */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <h2 className="mb-6 text-h2 font-extrabold">Picked this week</h2>
        {featured.length > 0 ? (
          <ProductGrid products={featured} />
        ) : (
          <Empty
            title="No products yet"
            detail={
              brandCount > 0
                ? "Brands and categories are set up. Add your first product from the owner console to see it here."
                : "Run the seed script to create your brands and categories, then add products from the owner console."
            }
          />
        )}
      </section>
    </>
  );
}
