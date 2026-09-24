import { notFound } from "next/navigation";
import { displayPrice, getProductBySlug } from "@/server/catalog";
import Link from "next/link";
import { VegMark, Price, BRAND_ACCENT, Rating } from "@/components/ui";
import { ProductGallery } from "@/components/product/product-gallery";
import { StickyBuyBar } from "@/components/product/sticky-buy-bar";
import { AddToBasket } from "@/components/add-to-basket";
import { formatBestBefore, formatDate } from "@/lib/format";
import { SUPPLEMENT_DISCLAIMER } from "@/lib/compliance/claims";
import { assessShippability } from "@/lib/compliance/shelf-life";
import { productAvailability } from "@/lib/checkout/availability";
import { SLOWEST_SERVED_ZONE, estimateDeliveryDate } from "@/lib/checkout/delivery";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { ReviewForm } from "@/components/review-form";
import { ageLabel, allergenLabel, sugarLabel } from "@/lib/label-facts";
import { SERVICE_AREA } from "@/lib/checkout/service-area";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product: any = await getProductBySlug(slug);
  if (!product || !product.isActive) return {};

  const title = `${product.name} — ${product.brand?.name ?? "SooulOne"}`;
  const description = product.shortDescription;

  return {
    title,
    description,
    openGraph: { title, description, images: product.images?.[0]?.url ? [product.images[0].url] : undefined },
  };
}

const NUTRIENT_LABELS: Record<string, string> = {
  energyKcal: "Energy",
  proteinG: "Protein",
  carbohydrateG: "Carbohydrate",
  totalSugarsG: "of which sugars",
  totalFatG: "Total fat",
  saturatedFatG: "of which saturates",
  transFatG: "Trans fat",
  fibreG: "Dietary fibre",
  sodiumMg: "Sodium",
};

const NUTRIENT_UNITS: Record<string, string> = {
  energyKcal: "kcal",
  sodiumMg: "mg",
};

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // A database error propagates to the nearest error.tsx rather than being
  // disguised as "product doesn't exist" — an outage and a bad slug need
  // different responses, and only one of them is this page's job to detect.
  const product: any = await getProductBySlug(slug);
  if (!product || !product.isActive) notFound();

  // The session cookie is issued by proxy.ts before this renders, so it's the
  // same identity the cart and checkout events join against. recordEvent
  // never throws, so a funnel miss can't stop the page rendering.
  const sessionId = await readSessionId();
  if (sessionId) void recordEvent(sessionId, "PRODUCT_VIEW", { productId: product.id });

  const isSupplement = product.regulatoryType === "HEALTH_SUPPLEMENT";
  const price = displayPrice(product);

  /**
   * The basket's own rule (FEFO + shelf-life at delivery), so this page can't
   * offer stock the basket would refuse. Estimated against the slowest zone,
   * as the basket does before a pincode is known. The best-before shown is the
   * pack we'd actually send first, not the newest one in the warehouse.
   */
  const availability = productAvailability(
    {
      regulatoryType: product.regulatoryType,
      shelfLifeDays: product.shelfLifeDays,
      stockQuantity: product.stockQuantity,
      lowStockThreshold: product.lowStockThreshold,
      retailOnly: product.retailOnly,
      batches: (product.batches ?? []).map((b: any) => ({
        id: b.id,
        batchNumber: b.batchNumber,
        expiresOn: new Date(b.expiresOn),
        quantityRemaining: b.quantityRemaining,
      })),
    },
    estimateDeliveryDate(new Date(), SLOWEST_SERVED_ZONE),
  );
  const soonestBestBefore = availability.soonestBestBefore;
  const shippability = product.shelfLifeDays ? assessShippability(product.shelfLifeDays) : null;

  const nutrition = (product.nutritionFacts ?? null) as Record<string, number> | null;
  const supplementFacts = (product.supplementFacts ?? null) as
    | { ingredient: string; amountPerServing: string; percentRDA: number | null }[]
    | null;

  const arrivesBy = estimateDeliveryDate(new Date(), SLOWEST_SERVED_ZONE);
  const fssai = process.env.NEXT_PUBLIC_FSSAI_LICENCE_NUMBER;
  const accent = BRAND_ACCENT[product.brand?.slug] ?? "var(--color-ink)";
  const buyable = availability.state === "in" || availability.state === "low";
  const age = ageLabel(product.suitableFromAge, product.suitableToAge);
  const facts = [sugarLabel(product), allergenLabel(product.allergens)].filter(Boolean) as string[];
  const isKids = product.brand?.slug === "kids-vault";

  return (
    <article className="mx-auto max-w-6xl px-5 py-8 lg:py-10">
      <nav className="mb-5 text-small text-ink-faint">
        {product.brand?.name} / {product.category?.name}
      </nav>

      {/* Phones: photo, then name and buy box, then details. Desktop: photo and
          details on the left, name and buy box sticky on the right. */}
      <div className="grid gap-8 lg:grid-cols-[1fr_400px] lg:gap-x-12">
        <div className="lg:col-start-1 lg:row-start-1">
          <ProductGallery
            images={(product.images ?? []).map((i: any) => ({ url: i.url, altText: i.altText }))}
            name={product.name}
            accent={accent}
            fallbackLabel={product.category?.name ?? product.brand?.name ?? ""}
          />
        </div>

        <aside className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <div className="flex items-start justify-between gap-4">
            <h1 className="max-w-[18ch] text-h1 font-extrabold">{product.name}</h1>
            <VegMark isVeg={product.isVeg} showText />
          </div>
          {product.rating && (
            <a href="#reviews" className="mt-2 inline-block hover:underline">
              <Rating avg={product.rating.avg} count={product.rating.count} />
            </a>
          )}
          <p className="mt-3 text-lead text-ink-soft">{product.shortDescription}</p>

          {/* The label's key facts as plain numbers, before any selling. */}
          {facts.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="At a glance">
              {facts.map((f) => (
                <li key={f} className="border border-[--color-rule] px-2.5 py-1 text-micro font-semibold" style={{ borderRadius: "var(--radius-panel)" }}>
                  {f}
                </li>
              ))}
            </ul>
          )}

          {/* Kids Vault: who it's for and how to give it, above the button,
              because a parent decides on this before anything else. */}
          {age && (isKids || isSupplement) && (
            <div className="mt-5 border-l-4 px-4 py-3" style={{ borderColor: accent, background: "color-mix(in srgb, " + accent + " 8%, white)" }}>
              <p className="font-display text-lead font-bold" style={{ color: accent }}>{age}</p>
              {isSupplement && product.dosageGuidance && <p className="mt-1 text-small">{product.dosageGuidance}</p>}
              {isKids && (
                <p className="mt-2 text-micro text-ink-soft">
                  Not recommended under {product.suitableFromAge} years. Supervise young children while they chew. Keep out of reach of children.
                </p>
              )}
            </div>
          )}

          <div id="buy-box" className="panel mt-6">
            <div className="panel-head flex items-center justify-between">
              <Price pricePaise={price.pricePaise} comparePaise={price.comparePaise} percentOff={price.percentOff} />
              <span className="text-micro font-normal text-ink-faint">incl. GST</span>
            </div>

            <div className="p-3.5">
              {availability.state === "retail-only" ? (
                <p className="text-small">Sold in our superstores only. This product is not shipped.</p>
              ) : availability.state === "out" ? (
                <p className="text-small text-caution">{availability.message}</p>
              ) : (
                <>
                  {/* Real stock at or below the owner's reorder level, never invented. */}
                  {availability.state === "low" && (
                    <p className="mb-3 text-small font-semibold" style={{ color: "var(--color-caution)" }}>
                      Only {availability.shippableUnits} left
                    </p>
                  )}
                  <AddToBasket
                    productId={product.id}
                    productName={product.name}
                    pack={isSupplement && product.servingsPerContainer ? { servings: product.servingsPerContainer, pricePaise: price.pricePaise } : undefined}
                  />
                </>
              )}

              {/* The answers to "is this genuine, fresh, and safe to order?" sit
                  right under the button, where the hesitation happens. Each line
                  is a fact the system enforces, not a slogan. */}
              {buyable && (
                <ul className="mt-4 grid gap-1.5 border-t border-[--color-rule] pt-3 text-micro text-ink-soft">
                  <li>Shipped by SooulOne itself, not a marketplace seller</li>
                  {soonestBestBefore && <li>Best before {formatBestBefore(soonestBestBefore)} on the pack we&rsquo;d send you</li>}
                  <li>Delivering across {SERVICE_AREA.label}: arrives by {formatDate(arrivesBy)} at the latest · cash on delivery available</li>
                  <li>
                    <Link href="/policies/refunds" className="underline">Returns and refunds</Link>
                    {fssai && <> · FSSAI licence <span className="tabular">{fssai}</span></>}
                  </li>
                </ul>
              )}

              {product.availableInRetail && !product.retailOnly && (
                <p className="mt-3 text-micro text-ink-faint">Also carried in our stores. We don&rsquo;t show live in-store stock.</p>
              )}

              {shippability && !shippability.isShippable && (
                <p className="mt-3 text-micro text-alert">This product&rsquo;s shelf life leaves no lawful window for shipping.</p>
              )}
            </div>
          </div>

          {/* PACKAGED_FOOD and BEVERAGE: nutrient table */}
          {!isSupplement && nutrition && (
            <div className="panel mt-5">
              <div className="panel-head">
                Nutrition per {nutrition.servingSizeG ?? "—"} g
              </div>
              <dl>
                {Object.entries(NUTRIENT_LABELS).map(([key, label]) =>
                  nutrition[key] === undefined ? null : (
                    <div className="panel-row" key={key}>
                      <dt className={label.startsWith("of which") ? "pl-4 text-ink-soft" : ""}>
                        {label}
                      </dt>
                      <dd>
                        {nutrition[key]} {NUTRIENT_UNITS[key] ?? "g"}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          )}

          {/* HEALTH_SUPPLEMENT: supplement facts */}
          {isSupplement && supplementFacts && supplementFacts.length > 0 && (
            <div className="panel mt-5">
              <div className="panel-head">
                Supplement facts
                {product.servingsPerContainer && (
                  <span className="ml-2 text-micro font-normal text-ink-faint">
                    {product.servingsPerContainer} servings
                  </span>
                )}
              </div>
              <dl>
                {supplementFacts.map((row) => (
                  <div className="panel-row" key={row.ingredient}>
                    <dt>{row.ingredient}</dt>
                    <dd>
                      {row.amountPerServing}
                      {row.percentRDA !== null && (
                        <span className="ml-2 text-ink-faint">{row.percentRDA}% RDA</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </aside>

        <div className="lg:col-start-1 lg:row-start-2">
          <div className="max-w-[68ch] whitespace-pre-line text-base leading-relaxed">{product.description}</div>

          {isSupplement && product.dosageGuidance && (
            <div className="panel mt-8 max-w-[52ch]">
              <div className="panel-head">How to take it</div>
              <p className="px-3.5 py-3 text-small">{product.dosageGuidance}</p>
            </div>
          )}

          {/* Allergens are a safety declaration, so they get their own block
              rather than being folded into a spec list someone might skim. */}
          {product.allergens?.length > 0 && (
            <div className="mt-6 border-l-4 border-alert bg-shelf px-4 py-3">
              <p className="text-small font-semibold">Allergen information</p>
              <p className="mt-1 text-small">Contains {product.allergens.join(", ")}.</p>
            </div>
          )}

          {isSupplement && (
            <div className="mt-8 max-w-[68ch] border-t border-[--color-rule] pt-5">
              <p className="text-small text-ink-soft">{SUPPLEMENT_DISCLAIMER}</p>
            </div>
          )}
        </div>
      </div>

      {buyable && (
        <StickyBuyBar
          targetId="buy-box"
          productId={product.id}
          name={product.name}
          pricePaise={price.pricePaise}
          note={`Arrives by ${formatDate(arrivesBy)} · cash on delivery`}
        />
      )}

      {/* FAQ block — Section 7.1 requires this on supplement pages. */}
      {isSupplement && (
        <section className="mt-16 max-w-[68ch] border-t border-[--color-rule] pt-8">
          <h2 className="text-h2 font-extrabold">Common questions</h2>
          <dl className="mt-6 grid gap-5">
            {[
              [
                "When should I take this?",
                product.dosageGuidance ??
                  "Follow the dosage on the pack and do not exceed the stated daily amount.",
              ],
              [
                "How long before I notice anything?",
                "Nutritional support builds gradually. Give any daily supplement several weeks of consistent use, alongside a balanced diet.",
              ],
              [
                "Can I take this with medication?",
                "Speak to a qualified healthcare professional first if you take prescribed medication, are pregnant or are breastfeeding.",
              ],
              [
                "Is this suitable for children?",
                "Only products in the Kids Vault range are formulated for children. Check the pack before giving any supplement to a child.",
              ],
            ].map(([q, a]) => (
              <div key={q}>
                <dt className="font-semibold">{q}</dt>
                <dd className="mt-1 text-ink-soft">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section id="reviews" className="mt-16 max-w-[68ch] scroll-mt-24 border-t border-[--color-rule] pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-h2 font-extrabold">Reviews</h2>
          {product.rating && <Rating avg={product.rating.avg} count={product.rating.count} />}
        </div>

        {product.reviews?.length > 0 ? (
          <div className="mt-6 grid gap-5">
            {product.reviews.map((r: any) => (
              <div key={r.id} className="border-b border-[--color-rule] pb-5">
                <div className="flex items-center gap-2">
                  <span aria-hidden style={{ color: "var(--color-caution)" }}>
                    {"★".repeat(r.rating)}
                    {"☆".repeat(5 - r.rating)}
                  </span>
                  <span className="text-small font-semibold">{r.customerName}</span>
                  <span className="text-micro text-ink-faint">{formatDate(r.createdAt)}</span>
                </div>
                <p className="mt-2 text-small text-ink-soft">{r.comment}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-small text-ink-faint">No reviews yet — be the first.</p>
        )}

        <div className="mt-8">
          <h3 className="mb-4 text-h3 font-bold">Write a review</h3>
          <ReviewForm productId={product.id} />
        </div>
      </section>
    </article>
  );
}
