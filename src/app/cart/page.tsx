import Link from "next/link";
import { quoteCart, readSessionId } from "@/server/cart";
import { Empty, PageHeader, VegMark } from "@/components/ui";
import { CartQuantity } from "@/components/cart-quantity";
import { formatINR, formatPriceTag } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your basket — SooulOne" };

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function CartPage() {
  const sessionId = await readSessionId();
  let result = null;
  try {
    result = sessionId ? await quoteCart(sessionId) : null;
  } catch (error) {
    reportError("cart", error);
    result = null;
  }

  if (!result || result.cartItems.length === 0) {
    return (
      <>
        <PageHeader title="Your basket" />
        <div className="mx-auto max-w-6xl px-5 py-12">
          <Empty
            title="Nothing in the basket yet"
            detail="Snacks from The True Store and gummies from any of our three brands go in the same basket and ship together."
            action={
              <div className="flex justify-center gap-3">
                <Link href="/true-store" className="btn btn-solid">
                  Shop The True Store
                </Link>
                <Link href="/gummies" className="btn btn-outline">
                  Shop gummies
                </Link>
              </div>
            }
          />
        </div>
      </>
    );
  }

  const { quote, cartItems, estimatedDeliveryDate } = result;
  const itemById = new Map(cartItems.map((i: any) => [i.productId, i]));

  return (
    <>
      <PageHeader title="Your basket" />

      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-[1fr_340px]">
        <div>
          <ul>
            {quote.lines.map((line) => {
              const item = itemById.get(line.productId) as any;
              const blocked = line.status !== "OK";

              return (
                <li key={line.productId} className="shelf-row flex gap-4 py-5">
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/product/${item?.product?.slug ?? ""}`}
                          className="font-semibold hover:underline"
                        >
                          {line.name}
                        </Link>
                        <p className="mt-0.5 text-micro text-ink-faint">
                          {item?.product?.brand?.name}
                        </p>
                      </div>
                      <VegMark isVeg={item?.product?.isVeg ?? null} />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <CartQuantity itemId={item?.id ?? ""} quantity={line.quantityRequested} name={line.name} />
                      <span className="tabular text-small">
                        {line.productDiscountPaise > 0 && (
                          <s className="mr-2 text-ink-faint">{formatPriceTag(line.listGrossPaise)}</s>
                        )}
                        {formatPriceTag(line.grossPaise)}
                        {line.bundleDiscountPaise > 0 && (
                          <span className="ml-2 text-veg">
                            −{formatINR(line.bundleDiscountPaise)} {line.bundleName}
                          </span>
                        )}
                        {line.discountPaise > 0 && (
                          <span className="ml-2 text-veg">−{formatINR(line.discountPaise)}</span>
                        )}
                      </span>
                    </div>

                    {/* Compliance outcome stated plainly, at the line it affects. */}
                    {blocked && (
                      <p className="mt-3 border-l-4 border-alert bg-shelf px-3 py-2 text-small">
                        {line.customerMessage}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="panel">
            <div className="panel-head">Order summary</div>
            <dl>
              <div className="panel-row">
                <dt>Items</dt>
                <dd>{formatINR(quote.listSubtotalPaise)}</dd>
              </div>
              {quote.productDiscountPaise > 0 && (
                <div className="panel-row">
                  <dt>Product discounts</dt>
                  <dd className="text-veg">−{formatINR(quote.productDiscountPaise)}</dd>
                </div>
              )}
              {quote.bundleDiscountPaise > 0 && (
                <div className="panel-row">
                  <dt>Bundle offer ({quote.appliedBundles.map((b) => b.name).join(", ")})</dt>
                  <dd className="text-veg">−{formatINR(quote.bundleDiscountPaise)}</dd>
                </div>
              )}
              {quote.discountPaise > 0 && (
                <div className="panel-row">
                  <dt>Discount {quote.appliedCouponCode && `(${quote.appliedCouponCode})`}</dt>
                  <dd className="text-veg">−{formatINR(quote.discountPaise)}</dd>
                </div>
              )}
              <div className="panel-row">
                <dt>Delivery</dt>
                <dd>{quote.shippingPaise === 0 ? "Free" : formatINR(quote.shippingPaise)}</dd>
              </div>
              <div className="panel-row text-ink-faint">
                <dt>of which GST</dt>
                <dd>{formatINR(quote.taxPaise)}</dd>
              </div>
              <div className="panel-row font-display text-lead font-bold">
                <dt>Total</dt>
                <dd>{formatINR(quote.totalPaise)}</dd>
              </div>
            </dl>

            <div className="p-3.5">
              {quote.canProceed ? (
                <Link href="/checkout" className="btn btn-solid w-full">
                  Checkout
                </Link>
              ) : (
                <>
                  <button disabled className="btn btn-solid w-full">
                    Checkout
                  </button>
                  <p className="mt-2 text-small text-alert">
                    Remove or reduce the flagged items to continue.
                  </p>
                </>
              )}
              <p className="mt-3 text-micro text-ink-faint">
                Estimated arrival by {formatDate(estimatedDeliveryDate)}. We reserve the
                longest-dated stock that meets the delivery freshness rule.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
