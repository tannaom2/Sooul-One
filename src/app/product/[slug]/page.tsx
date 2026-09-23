import { notFound } from "next/navigation";
import { displayPrice, getProductBySlug } from "@/server/catalog";
import { VegMark, Price } from "@/components/ui";
import { AddToBasket } from "@/components/add-to-basket";
import { formatBestBefore, formatDate } from "@/lib/format";
import { SUPPLEMENT_DISCLAIMER } from "@/lib/compliance/claims";
import {
  assessShippability,
  evaluateBatchForDelivery,
} from "@/lib/compliance/shelf-life";
import { estimateDeliveryDate } from "@/lib/checkout/delivery";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { ReviewForm } from "@/components/review-form";

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
   * Show the shopper the earliest best-before date they could actually be sent,
   * not the latest one in the warehouse. FEFO means the oldest compliant batch
   * ships first, so quoting the newest date would be a promise the fulfilment
   * logic has no intention of keeping.
   */
  const deliveryEstimate = estimateDeliveryDate(new Date(), "REST_OF_INDIA");
  const shippableBatches = (product.batches ?? []).filter((b: any) => {
    if (b.quantityRemaining <= 0) return false;
    if (!product.shelfLifeDays) return new Date(b.expiresOn) > deliveryEstimate;
    return evaluateBatchForDelivery(
      { id: b.id, batchNumber: b.batchNumber, expiresOn: new Date(b.expiresOn), quantityRemaining: b.quantityRemaining },
      product.shelfLifeDays,
      deliveryEstimate,
    ).isEligible;
  });

  const soonestBestBefore = shippableBatches[0]?.expiresOn ?? null;
  const inStock = shippableBatches.length > 0 || product.stockQuantity > 0;
  const shippability = product.shelfLifeDays ? assessShippability(product.shelfLifeDays) : null;

  const nutrition = (product.nutritionFacts ?? null) as Record<string, number> | null;
  const supplementFacts = (product.supplementFacts ?? null) as
    | { ingredient: string; amountPerServing: string; percentRDA: number | null }[]
    | null;

  return (
    <article className="mx-auto max-w-6xl px-5 py-10">
      <nav className="mb-6 text-small text-ink-faint">
        {product.brand?.name} / {product.category?.name}
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1fr_400px]">
        {/* ---------------- Left: identity and copy ---------------- */}
        <div>
          <div className="flex items-start justify-between gap-4">
            <h1 className="max-w-[18ch] text-h1 font-extrabold">{product.name}</h1>
            <VegMark isVeg={product.isVeg} showText />
          </div>

          <p className="mt-4 max-w-[60ch] text-lead text-ink-soft">{product.shortDescription}</p>

          <div className="mt-8 max-w-[68ch] whitespace-pre-line text-base leading-relaxed">
            {product.description}
          </div>

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

        {/* ---------------- Right: buy box and statutory panel ---------------- */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="panel">
            <div className="panel-head flex items-center justify-between">
              <Price pricePaise={price.pricePaise} comparePaise={price.comparePaise} percentOff={price.percentOff} />
              <span className="text-micro font-normal text-ink-faint">incl. GST</span>
            </div>

            <div className="p-3.5">
              {product.retailOnly ? (
                <p className="text-small">
                  Sold in our superstores only. This product is not shipped.
                </p>
              ) : inStock ? (
                <AddToBasket productId={product.id} productName={product.name} />
              ) : (
                <p className="text-small text-caution">
                  Temporarily unavailable. Our remaining stock is too close to its best-before date
                  to ship.
                </p>
              )}

              {soonestBestBefore && (
                <p className="mt-3 text-micro text-ink-faint">
                  Best before {formatBestBefore(soonestBestBefore)} on the stock we would send you.
                </p>
              )}

              {product.availableInRetail && !product.retailOnly && (
                <p className="mt-2 text-micro text-ink-faint">
                  Also carried in our stores. We don&rsquo;t show live in-store stock.
                </p>
              )}

              {shippability && !shippability.isShippable && (
                <p className="mt-3 text-micro text-alert">
                  This product&rsquo;s shelf life leaves no lawful window for shipping.
                </p>
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
      </div>

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

      <section className="mt-16 max-w-[68ch] border-t border-[--color-rule] pt-8">
        <h2 className="text-h2 font-extrabold">Reviews</h2>

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
