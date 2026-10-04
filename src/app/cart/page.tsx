import Link from "next/link";
import Image from "next/image";
import { basketBoxes, loadBasketKits, priceNoteFor, quoteCart, readSessionId } from "@/server/cart";
import { Empty, PageHeader, VegMark } from "@/components/ui";
import { CartQuantity } from "@/components/cart-quantity";
import { KitBlock } from "@/components/basket/kit-block";
import { BoxBlock } from "@/components/basket/box-block";
import { RemoveUnavailableButton } from "@/components/remove-unavailable-button";
import { formatPriceTag } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your basket" };

export default async function CartPage() {
  const sessionId = await readSessionId();
  let result = null;
  try {
    result = sessionId ? await quoteCart(sessionId) : null;
  } catch (error) {
    reportError("cart", error);
    result = null;
  }

  if (!result || (result.cartItems.length === 0 && result.cartBoxes.length === 0)) {
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
  const itemById = new Map(cartItems.map((i) => [i.productId, i]));
  const kits = await loadBasketKits(result);
  const kitUnits = new Map(kits.flatMap((k) => k.members.map((m) => [m.productId, m.units] as const)));
  const boxes = basketBoxes(result);
  const boxNeedsAttention = boxes.some((b) => b.issue);
  const linesBlocked = quote.lines.some((l) => l.status !== "OK");
  // A kit product's extra units first, next to the kits; units inside a kit are shown in the kit.
  const shownLines = quote.lines
    .filter((l) => !l.boxId && l.quantityRequested - (kitUnits.get(l.productId) ?? 0) > 0)
    .sort((a, b) => Number(kitUnits.has(b.productId)) - Number(kitUnits.has(a.productId)));
  // Labels only when there's more than one kind of thing to tell apart.
  const labelled = [boxes.length, kits.length, shownLines.length].filter((n) => n > 0).length > 1;
  const label = (text: string) => labelled && <h2 className="text-micro font-semibold tracking-wide text-ink-soft uppercase">{text}</h2>;

  return (
    <>
      <PageHeader title="Your basket" />

      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-[1fr_340px]">
        <div>
          {boxes.length > 0 && (
            <section className="mb-6">
              {label(boxes.length === 1 ? "Box" : "Boxes")}
              <ul>
                {boxes.map((box) => (
                  <li key={box.cartBoxId} className="shelf-row py-5">
                    <BoxBlock box={box} refreshPage tile={88} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {kits.length > 0 && (
            <section className="mb-6">
              {label(kits.length === 1 ? "Combo" : "Combos")}
              <ul>
                {kits.map((kit) => (
                  <li key={kit.bundleId} className="shelf-row py-5">
                    <KitBlock kit={kit} refreshPage tile={88} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {label("Items")}
          <ul>
            {shownLines.map((line) => {
              // Units inside a kit are shown in the kit above; this line shows the rest.
              const inKits = kitUnits.get(line.productId) ?? 0;
              const extraAvailable = Math.max(0, line.quantityAvailable - inKits);
              const unitPaise = line.quantityAvailable > 0 ? line.grossPaise / line.quantityAvailable : 0;
              const listUnitPaise = line.quantityAvailable > 0 ? line.listGrossPaise / line.quantityAvailable : 0;
              const item = itemById.get(line.productId);
              const blocked = line.status !== "OK";
              const priceNote = item ? priceNoteFor(item) : null;

              return (
                <li key={line.productId} className="shelf-row flex gap-4 py-5">
                  {item?.product?.images?.[0]?.url ? (
                    <Image src={item.product.images[0].url} alt="" width={88} height={88} sizes="88px" className="h-[88px] w-[88px] shrink-0 self-start border border-rule object-cover" />
                  ) : (
                    <div className="h-[88px] w-[88px] shrink-0 bg-shelf" style={{ borderRadius: "var(--radius-panel)" }} aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
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
                          {inKits > 0 && " · extra, at the usual price"}
                        </p>
                      </div>
                      <VegMark isVeg={item?.product?.isVeg ?? null} />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <CartQuantity itemId={item?.id ?? ""} quantity={line.quantityRequested} inKits={inKits} name={line.name} />
                      {/* At the right edge, in line with a box's or combo's price above. */}
                      <span className="tabular ml-auto text-right text-small">
                        <span className="block font-semibold">{formatPriceTag(Math.round(unitPaise * extraAvailable))}</span>
                        {line.productDiscountPaise > 0 && (
                          <s className="text-micro text-ink-faint">{formatPriceTag(Math.round(listUnitPaise * extraAvailable))}</s>
                        )}
                      </span>
                    </div>

                    {/* Compliance outcome stated plainly, at the line it affects. */}
                    {blocked && (
                      <p className="mt-3 border-l-4 border-alert bg-shelf px-3 py-2 text-small">
                        {line.customerMessage}
                      </p>
                    )}
                    {priceNote && (
                      <p className="mt-3 border-l-4 border-rule bg-shelf px-3 py-2 text-small">{priceNote}</p>
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
                <dd>{formatPriceTag(quote.listSubtotalPaise)}</dd>
              </div>
              {quote.productDiscountPaise > 0 && (
                <div className="panel-row">
                  <dt>Product discounts</dt>
                  <dd className="text-veg">−{formatPriceTag(quote.productDiscountPaise)}</dd>
                </div>
              )}
              {quote.bundleDiscountPaise > 0 && (
                <div className="panel-row">
                  <dt>Combo savings</dt>
                  <dd className="text-veg">−{formatPriceTag(quote.bundleDiscountPaise)}</dd>
                </div>
              )}
              {quote.discountPaise > 0 && (
                <div className="panel-row">
                  <dt>Discount {quote.appliedCouponCode && `(${quote.appliedCouponCode})`}</dt>
                  <dd className="text-veg">−{formatPriceTag(quote.discountPaise)}</dd>
                </div>
              )}
              <div className="panel-row">
                <dt>Delivery</dt>
                <dd>{quote.shippingPaise === 0 ? "Free" : formatPriceTag(quote.shippingPaise)}</dd>
              </div>
              <div className="panel-row text-ink-faint">
                <dt>of which GST</dt>
                <dd>{formatPriceTag(quote.taxPaise)}</dd>
              </div>
              <div className="panel-row font-display text-lead font-bold">
                <dt>Total</dt>
                <dd>{formatPriceTag(quote.totalPaise)}</dd>
              </div>
            </dl>

            <div className="p-3.5">
              {quote.canProceed ? (
                <Link href="/checkout" className="btn btn-solid w-full">
                  Checkout
                </Link>
              ) : (
                <>
                  <p className="mb-2 text-small text-alert">
                    {boxNeedsAttention && !linesBlocked
                      ? "Your box needs attention: fix it or remove it to check out."
                      : "Some items can\u2019t ship as they are. Remove them to check out with the rest."}
                  </p>
                  {linesBlocked && <RemoveUnavailableButton />}
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
