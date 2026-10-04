import Link from "next/link";
import { ProductCard } from "@/components/ui";
import { getHomeRail } from "@/server/home-rail";
import { getTopBar } from "@/server/site-content";
import { getShippingPolicy, getStoreControls } from "@/server/store-settings";
import { getBusinessProfile } from "@/server/business";
import { absoluteUrl, jsonLdScript, organizationJsonLd, websiteJsonLd } from "@/lib/structured-data";
import { trustFacts, type TrustFact } from "@/lib/trust-strip";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

const GUMMIES = [
  { slug: "woman-axis", name: "Woman Axis", line: "Daily vitamins through to sleep, stress and PMS support.", accent: "var(--color-womanaxis)" },
  { slug: "kids-vault", name: "Kids Vault", line: "Multivitamin, immunity, eye care, focus and calcium for children.", accent: "var(--color-kidsvault)" },
  { slug: "man-rituals", name: "Man Rituals", line: "Vitality, multivitamin and hair support for men.", accent: "var(--color-manrituals)" },
];

/** An example label, the hero's picture: every product page shows its own declared figures. */
const PANEL: [string, string][] = [
  ["Energy", "123 kcal"],
  ["Protein", "5.7 g"],
  ["Total sugars", "0.9 g"],
  ["Total fat", "3.6 g"],
  ["Dietary fibre", "4.5 g"],
  ["Sodium", "144 mg"],
];

function NutritionPanel({ className = "" }: { className?: string }) {
  return (
    <div className={`panel self-start ${className}`}>
      <div className="panel-head flex items-center justify-between">
        <span>Nutrition per 30 g</span>
        <span className="mark mark-veg" role="img" aria-label="Vegetarian" />
      </div>
      <dl>
        {PANEL.map(([k, v]) => (
          <div className="panel-row" key={k}>
            <dt className={k.startsWith("of which") ? "pl-4 text-ink-soft" : ""}>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="px-3.5 py-2.5 text-micro text-ink-faint">An example panel. Every product shows its own declared figures.</p>
    </div>
  );
}

export default async function Home() {
  // The catalogue may be empty before the owner has added anything. Failing
  // softly here matters: a database that is merely unseeded should render the
  // site, not a stack trace.
  let rail: Awaited<ReturnType<typeof getHomeRail>> = [];
  let trust: TrustFact[] = [];
  let seller: { name: string; phone: string | null; email: string | null } = { name: "SooulOne", phone: null, email: null };
  try {
    const [products, messages, controls, shipping, business] = await Promise.all([getHomeRail(), getTopBar(), getStoreControls(), getShippingPolicy(), getBusinessProfile()]);
    rail = products;
    // Facts the store keeps, less any the top bar already says (src/lib/trust-strip.ts).
    trust = trustFacts(
      { fssaiLicence: business.fssaiLicence, codEnabled: controls.codEnabled, freeDeliveryAbove: shipping.freeAbovePaise > 0 && shipping.flatRatePaise > 0 ? Math.round(shipping.freeAbovePaise / 100) : null },
      messages.map((m) => m.text),
    );
    seller = { name: business.tradeName ?? business.legalName ?? "SooulOne", phone: business.customerCarePhone, email: business.customerCareEmail };
  } catch (error) {
    reportError("home", error);
  }
  // For search results: the business's name, logo and customer care, and the site's own name.
  const site = process.env.SITE_URL ?? "http://localhost:3000";
  const structured = [
    organizationJsonLd({ ...seller, url: absoluteUrl("/", site), logo: absoluteUrl("/android-chrome-512x512.png", site) }),
    websiteJsonLd({ name: "SooulOne", url: absoluteUrl("/", site) }),
  ];

  return (
    <>
      {/* Data blocks, never executed, so the CSP's script rules don't apply to them. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(structured) }} />
      {/* HERO — the most characteristic thing in this brief is the label
          itself, so the hero is a label, not a lifestyle photograph. Kept
          short, so products reach the first screen on every size. */}
      <section>
        <div className="mx-auto grid max-w-6xl gap-8 px-5 pt-8 pb-6 sm:grid-cols-[1.4fr_0.6fr] sm:pt-10 lg:grid-cols-[1.25fr_0.75fr] lg:gap-14 lg:pt-14 lg:pb-10">
          <div className="self-center">
            <h1 className="max-w-[16ch] text-[2.25rem] leading-[1.05] font-extrabold sm:text-hero">
              Read the label first. That&rsquo;s the point.
            </h1>
            <p className="mt-3 max-w-[52ch] text-base text-ink-soft sm:mt-4 sm:text-lead">
              Snacks and daily gummies with every nutrient, allergen and dose on the page before you add anything to your basket.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
              <Link href="/true-store" className="btn btn-solid justify-center">
                <span className="sm:hidden">The True Store</span>
                <span className="hidden sm:inline">Shop The True Store</span>
              </Link>
              <Link href="/gummies" className="btn btn-outline justify-center">
                <span className="sm:hidden">Gummies</span>
                <span className="hidden sm:inline">Shop gummies</span>
              </Link>
            </div>
          </div>
          {/* Beside the headline from tablet up; further down on a phone. */}
          <NutritionPanel className="hidden text-small sm:block" />
        </div>
      </section>

      {/* TRUST — facts from the store's own settings, spread edge to edge. */}
      {trust.length > 0 && (
        <section aria-label="Why you can trust what you order" className="border-y border-rule bg-shelf">
          <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-x-4 gap-y-1.5 px-5 py-2.5 text-small font-semibold sm:flex sm:justify-between">
            {trust.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-veg)" strokeWidth="2.5" aria-hidden="true" className="shrink-0">
                  <path d="M5 12l5 5L19 7" />
                </svg>
                {/* Phones get the short wording, so each fact fits its half of the row. */}
                {f.href ? (
                  <Link href={f.href} className="underline-offset-2 hover:underline">
                    <span className="sm:hidden">{f.short ?? f.text}</span>
                    <span className="hidden sm:inline">{f.text}</span>
                  </Link>
                ) : (
                  <>
                    <span className="sm:hidden">{f.short ?? f.text}</span>
                    <span className="hidden sm:inline">{f.text}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* BESTSELLERS — Featured picks, then the month's best sellers by units (src/lib/home-rail.ts). */}
      {rail.length > 0 && (
        <section className="mx-auto max-w-6xl pt-8 pl-5 lg:pr-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pr-5 lg:pr-0">
            <h2 className="text-h2 font-extrabold">Bestsellers</h2>
            <p className="text-small text-ink-soft">What people ordered most this month</p>
          </div>
          <ul className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pr-5 pb-2 lg:pr-0" aria-label="Bestsellers">
            {rail.map((p) => (
              <li key={p.id} className="flex w-[44%] shrink-0 snap-start sm:w-[30%] lg:w-[calc((100%-4rem)/5)]">
                <ProductCard product={p} compact />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mx-auto max-w-6xl px-5 pt-8 sm:hidden">
        <NutritionPanel className="text-small" />
      </div>

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
            className="flex flex-col justify-between gap-6 border border-rule p-6 hover:border-strong"
            style={{ background: "color-mix(in srgb, var(--color-truestore) 10%, var(--color-paper))" }}
          >
            <div>
              {/* Turmeric's text shade: the bright one is for fills and fails as text. */}
              <h3 className="text-h3 font-bold" style={{ color: "var(--color-truestore-text)" }}>
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
                className="border border-rule p-5 hover:border-strong"
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
    </>
  );
}
