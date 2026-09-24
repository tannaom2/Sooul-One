import Link from "next/link";
import Image from "next/image";
import { formatPriceTag } from "@/lib/money";
import { formatPercent } from "@/lib/pricing";
import type { ProductSummary } from "@/server/catalog";

/**
 * The statutory veg / non-veg mark.
 *
 * Rendered as geometry rather than an emoji: emoji render inconsistently
 * across platforms and this is a legally required mark, not decoration. When
 * the fact is genuinely unknown it says so instead of defaulting to
 * vegetarian, because for the gummies this depends on an unresolved
 * gelatin-versus-pectin decision.
 */
export function VegMark({ isVeg, showText = false }: { isVeg: boolean | null; showText?: boolean }) {
  if (isVeg === null || isVeg === undefined) {
    return (
      <span className="text-micro font-semibold text-caution" title="Not yet declared">
        Veg status not declared
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`mark ${isVeg ? "mark-veg" : "mark-nonveg"}`}
        role="img"
        aria-label={isVeg ? "Vegetarian" : "Non-vegetarian"}
      />
      {showText && (
        <span className="text-micro font-semibold">{isVeg ? "Vegetarian" : "Non-vegetarian"}</span>
      )}
    </span>
  );
}

/**
 * Average of approved reviews. Rendered only when there is at least one:
 * no empty stars on a product nobody has reviewed yet.
 */
export function Rating({ avg, count, size = "small" }: { avg: number; count: number; size?: "small" | "micro" }) {
  // Conservative: a star fills only from .75, so the stars never read higher
  // than the score (4.5 shows four and a number, not five).
  const full = Math.min(5, Math.floor(avg + 0.25));
  return (
    <span className={`inline-flex items-center gap-1.5 ${size === "micro" ? "text-micro" : "text-small"}`}>
      <span
        role="img"
        aria-label={`Rated ${avg} out of 5 from ${count} ${count === 1 ? "review" : "reviews"}`}
        style={{ color: "var(--color-caution)" }}
      >
        {"★".repeat(full)}
        <span className="text-[--color-rule]">{"★".repeat(5 - full)}</span>
      </span>
      <span className="tabular font-semibold" aria-hidden>{avg.toFixed(1)}</span>
      <span className="text-ink-faint" aria-hidden>({count})</span>
    </span>
  );
}

export function Price({
  pricePaise,
  comparePaise,
  percentOff,
}: {
  pricePaise: number;
  comparePaise?: number | null;
  percentOff?: number | null;
}) {
  const struck = comparePaise && comparePaise > pricePaise ? comparePaise : null;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      {struck && (
        <s className="tabular text-small text-ink-faint" aria-label={`Original price ${formatPriceTag(struck)}`}>
          {formatPriceTag(struck)}
        </s>
      )}
      <span className="tabular font-display text-lead font-bold">{formatPriceTag(pricePaise)}</span>
      {struck && percentOff ? (
        <span className="text-micro font-semibold text-veg">{formatPercent(percentOff)}% off</span>
      ) : null}
    </span>
  );
}

export const BRAND_ACCENT: Record<string, string> = {
  "the-true-store": "var(--color-truestore)",
  "woman-axis": "var(--color-womanaxis)",
  "kids-vault": "var(--color-kidsvault)",
  "man-rituals": "var(--color-manrituals)",
};

export function ProductCard({ product }: { product: ProductSummary }) {
  const accent = BRAND_ACCENT[product.brandSlug] ?? "var(--color-ink)";

  return (
    <Link
      href={`/product/${product.slug}`}
      className="group flex flex-col gap-3 border border-[--color-rule] p-4 transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-ink"
      style={{ borderRadius: "var(--radius-panel)" }}
    >
      {product.imageUrl ? (
        <Image
          src={product.imageUrl}
          alt={product.name}
          width={400}
          height={300}
          // One column on phones, two on tablets, three on desktop (ProductGrid).
          sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
          className="aspect-[4/3] w-full border border-[--color-rule] object-cover"
        />
      ) : (
        <div
          className="flex aspect-[4/3] items-end justify-start p-3"
          style={{ background: `color-mix(in srgb, ${accent} 12%, white)` }}
        >
          <span className="text-micro font-semibold" style={{ color: accent }}>
            {product.categoryName}
          </span>
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold leading-snug group-hover:underline">
          {product.name}
        </h3>
        <VegMark isVeg={product.isVeg} />
      </div>

      {product.rating && <Rating avg={product.rating.avg} count={product.rating.count} size="micro" />}

      {/* Declared label facts, as numbers: no peer in the field study shows grams of sugar. */}
      {(product.ageLabel || product.sugarLabel) && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-micro">
          {product.ageLabel && <span className="font-semibold" style={{ color: accent }}>{product.ageLabel}</span>}
          {product.sugarLabel && <span className="text-ink-soft">{product.sugarLabel}</span>}
        </p>
      )}

      <p className="text-small text-ink-soft">{product.shortDescription}</p>

      {/* Allergens sit on the card, not behind a click. The brief's research
          says label-conscious shoppers are the majority here, so hiding this
          costs conversions as well as being worse practice. */}
      {product.allergens.length > 0 && (
        <p className="text-micro text-ink-faint">Contains {product.allergens.join(", ")}</p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="grid">
          <Price pricePaise={product.pricePaise} comparePaise={product.comparePaise} percentOff={product.percentOff} />
          {product.unitPriceLabel && <span className="tabular text-micro text-ink-faint">{product.unitPriceLabel}</span>}
        </span>
        {product.retailOnly ? (
          <span className="text-micro font-semibold text-caution">In stores only</span>
        ) : product.availability.state === "out" ? (
          <span className="text-micro font-semibold text-caution">Out of stock</span>
        ) : product.availability.state === "low" ? (
          <span className="text-micro font-semibold text-caution">Only {product.availability.shippableUnits} left</span>
        ) : (
          product.availableInRetail && (
            <span className="text-micro text-ink-faint">Also in stores</span>
          )
        )}
      </div>
    </Link>
  );
}

export function ProductGrid({ products }: { products: ProductSummary[] }) {
  if (products.length === 0) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}

/**
 * Empty states are an invitation to act, not an apology. Each one says what is
 * missing and what to do about it.
 */
export function NoAccess() {
  return (
    <Empty
      title="You don't have access to this page"
      detail="Your role doesn't include this area. Ask the owner if you need it."
    />
  );
}

export function Empty({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="border border-dashed border-[--color-rule] p-10 text-center">
      <p className="font-display text-h3 font-bold">{title}</p>
      <p className="mx-auto mt-2 max-w-[48ch] text-small text-ink-soft">{detail}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  intro,
  accent,
}: {
  title: string;
  intro?: string;
  accent?: string;
}) {
  return (
    <div className="border-b border-[--color-rule] bg-shelf">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <h1 className="max-w-[20ch] text-h1 font-extrabold" style={accent ? { color: accent } : undefined}>
          {title}
        </h1>
        {intro && <p className="mt-3 max-w-[60ch] text-lead text-ink-soft">{intro}</p>}
      </div>
    </div>
  );
}
