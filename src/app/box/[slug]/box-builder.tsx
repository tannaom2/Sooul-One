"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { formatPriceTag } from "@/lib/money";
import { boxIssues, boxIssueMessage, priceBox, type BoxRule } from "@/lib/checkout/boxes";
import type { BoxPage } from "@/server/boxes";
import type { ProductSummary } from "@/server/catalog";
import { useCart } from "@/components/basket/cart-provider";
import { ProductCard } from "@/components/ui";

/**
 * The box page. The products are the site's standard product cards, with an
 * "Add to box" action underneath; the filter above them is the same tabs
 * (gummies) or chips (True Store) the shop pages use. A tray that stays in
 * view shows the slots filling, what the picks are worth and what the box
 * costs. Picks are kept in this browser across tabs and refreshes until the
 * box goes in the basket, where the server checks everything again.
 */

type Picks = Record<string, number>;
type Editing = { cartBoxId: string; picks: { productId: string; quantity: number }[] } | null;
type Filter = { field: "brandSlug" | "categorySlug"; value: string | null; param: "brand" | "concern" };

const draftKey = (slug: string) => `soulone_box_${slug}`;
const noop = () => () => {};

function readDraft(slug: string): Picks {
  try {
    const saved = localStorage.getItem(draftKey(slug));
    return saved ? (JSON.parse(saved) as Picks) : {};
  } catch {
    return {};
  }
}

/**
 * A saved draft only exists in the browser, so the builder starts from it
 * once hydrated (the server renders it empty, then the client remounts it
 * with the draft), the way checkout restores its form.
 */
export function BoxBuilder(props: { box: BoxPage; kindLabel: string; editing: Editing; tabs: React.ReactNode; filter: Filter }) {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const { box, editing } = props;
  let initial: Picks = {};
  if (editing) initial = Object.fromEntries(editing.picks.map((p) => [p.productId, p.quantity]));
  else if (hydrated) {
    const known = new Set(box.items.map((i) => i.id));
    initial = Object.fromEntries(Object.entries(readDraft(box.slug)).filter(([id, n]) => known.has(id) && n > 0));
  }
  return <Builder key={hydrated ? "client" : "server"} {...props} initial={initial} persist={hydrated && !editing} />;
}

function Builder({
  box,
  kindLabel,
  editing,
  tabs,
  filter,
  initial,
  persist,
}: {
  box: BoxPage;
  kindLabel: string;
  editing: Editing;
  tabs: React.ReactNode;
  filter: Filter;
  initial: Picks;
  persist: boolean;
}) {
  const router = useRouter();
  const { saveBox, pending } = useCart();
  const [picks, setPicks] = useState<Picks>(initial);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!persist) return;
    try {
      localStorage.setItem(draftKey(box.slug), JSON.stringify(picks));
    } catch {}
  }, [picks, persist, box.slug]);

  const byId = useMemo(() => new Map(box.items.map((i) => [i.id, i])), [box]);
  const rule: BoxRule = useMemo(
    () => ({
      id: box.id,
      name: box.name,
      size: box.size,
      pricePaise: box.pricePaise,
      maxPerProduct: box.maxPerProduct,
      slots: box.slots,
      eligible: new Map(box.items.map((i) => [i.id, box.slotOf[i.id]])),
    }),
    [box],
  );

  const pickList = Object.entries(picks)
    .filter(([id, n]) => n > 0 && byId.has(id))
    .map(([productId, quantity]) => ({ productId, quantity }));
  const count = pickList.reduce((n, p) => n + p.quantity, 0);
  const full = count >= box.size;
  const issues = boxIssues(rule, pickList);
  const complete = issues.length === 0;
  // The box's worth, at the price each item sells for today.
  const valuePaise = pickList.reduce((n, p) => n + byId.get(p.productId)!.pricePaise * p.quantity, 0);
  const { discountPaise } = priceBox(
    box.pricePaise,
    pickList.map((p) => {
      const item = byId.get(p.productId)!;
      return { unitListPaise: item.comparePaise && item.percentOff ? item.comparePaise : item.pricePaise, units: p.quantity };
    }),
  );
  const firstIssue = issues.find((i) => i.kind !== "TOO_FEW");

  const shown = filter.value ? box.items.filter((i) => i[filter.field] === filter.value) : box.items;

  // Nearly full with a sub-brand or category still untouched: suggest it, never require it.
  const bucketOf = (i: ProductSummary) => i[filter.field];
  const nameOf = (i: ProductSummary) => (filter.field === "brandSlug" ? i.brandName : i.categoryName);
  const untouched =
    count === box.size - 1
      ? box.items.find((i) => !pickList.some((p) => bucketOf(byId.get(p.productId)!) === bucketOf(i)))
      : undefined;
  const hrefFor = (value: string) => {
    const q = new URLSearchParams();
    if (editing) q.set("edit", editing.cartBoxId);
    q.set(filter.param, value);
    return `/box/${box.slug}?${q}`;
  };

  const change = (productId: string, delta: number) => {
    setAdded(false);
    setPicks((p) => ({ ...p, [productId]: Math.max(0, (p[productId] ?? 0) + delta) }));
  };

  async function addBox() {
    const ok = await saveBox({ boxId: box.id, picks: pickList, replaceCartBoxId: editing?.cartBoxId });
    if (!ok) return;
    if (editing) {
      router.push("/cart");
      return;
    }
    try {
      localStorage.removeItem(draftKey(box.slug));
    } catch {}
    setPicks({});
    setAdded(true);
  }

  const cta = editing ? "Save box" : `Add box to basket · ${formatPriceTag(box.pricePaise)}`;

  return (
    <div className="pb-40 lg:pb-16">
      <header className="mx-auto max-w-6xl px-5 py-10">
        <p className="text-micro font-semibold tracking-wide text-veg uppercase">{kindLabel} · make your own</p>
        <h1 className="mt-2 text-h1 font-extrabold">{box.name}</h1>
        <p className="mt-2 text-lead">
          Pick any {box.size} for <strong>{formatPriceTag(box.pricePaise)}</strong>
          {box.maxPerProduct === 1 ? ", all different" : ""}.
        </p>
        {box.description && <p className="mt-2 max-w-[60ch] text-ink-soft">{box.description}</p>}
      </header>

      {tabs}

      <div className="mx-auto max-w-6xl px-5 pt-6 lg:grid lg:grid-cols-[1fr_320px] lg:gap-10">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((item) => {
            const picked = picks[item.id] ?? 0;
            const leftToPick = item.availability.shippableUnits - picked;
            const canAdd = !full && picked < box.maxPerProduct && leftToPick > 0;
            const blockedBy = leftToPick <= 0 ? "No more left" : full ? "Box is full" : "Add to box";
            return (
              <ProductCard
                key={item.id}
                product={item}
                mode="box"
                selected={picked > 0}
                action={
                  picked > 0 ? (
                    <div className="flex items-center justify-between gap-2 border-t border-rule pt-3">
                      <span className="text-small font-semibold text-veg">✓ In box{picked > 1 ? ` × ${picked}` : ""}</span>
                      <span className="flex gap-1">
                        {canAdd && (
                          <button type="button" onClick={() => change(item.id, 1)} className="btn btn-outline px-3 py-1.5 text-small" aria-label={`Another ${item.name}`}>
                            +
                          </button>
                        )}
                        <button type="button" onClick={() => change(item.id, -1)} className="btn btn-outline px-3 py-1.5 text-small" aria-label={`Take ${item.name} out of the box`}>
                          Remove
                        </button>
                      </span>
                    </div>
                  ) : (
                    <button type="button" onClick={() => change(item.id, 1)} disabled={!canAdd} className="btn btn-solid w-full disabled:opacity-50">
                      {blockedBy}
                    </button>
                  )
                }
              />
            );
          })}
          {shown.length === 0 && <p className="text-small text-ink-soft">Nothing in this part of the box right now.</p>}
        </div>

        {/* The tray: bottom bar on a phone, a sidebar on a wide screen. */}
        <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-elevated px-5 pt-3 shadow-elevated lg:sticky lg:top-24 lg:self-start lg:border lg:p-4 lg:shadow-none" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", borderRadius: "var(--radius-panel)" }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-small font-semibold">
                <span className="tabular">{count}</span> of {box.size} picked
              </p>
              <div className="mt-1.5 flex gap-1.5" aria-hidden>
                {Array.from({ length: box.size }, (_, i) => (
                  <span key={i} className={`h-2.5 w-7 ${i < count ? "bg-veg" : "bg-shelf"}`} style={{ borderRadius: 999 }} />
                ))}
              </div>
            </div>
            <p className="tabular text-right text-small">
              <span className="block font-display text-lead font-bold">{formatPriceTag(box.pricePaise)}</span>
              {valuePaise > 0 && (
                <span className="text-micro text-ink-faint">
                  worth <s>{formatPriceTag(valuePaise)}</s>
                </span>
              )}
            </p>
          </div>

          {count > 0 && (
            // grid-cols-1 lets rows shrink to the tray, so long names truncate instead of pushing Remove out.
            <ul className="mt-3 hidden gap-2 text-small lg:grid lg:grid-cols-1">
              {pickList.map((p) => {
                const item = byId.get(p.productId)!;
                return (
                  <li key={p.productId} className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate" title={item.name}>
                        {item.name}
                        {p.quantity > 1 && <span className="text-ink-faint"> × {p.quantity}</span>}
                      </span>
                      <span className="block text-micro text-ink-faint">{nameOf(item)}</span>
                    </span>
                    <button type="button" onClick={() => change(p.productId, -1)} className="shrink-0 pt-0.5 text-micro underline" aria-label={`Take ${item.name} out`}>
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div aria-live="polite" role="status" className="mt-2 text-micro">
            {complete && discountPaise > 0 && <p className="font-semibold text-veg">You save {formatPriceTag(discountPaise)} on this box</p>}
            {complete && discountPaise === 0 && <p className="text-ink-soft">These cost less than the box price on their own, so you pay their usual prices.</p>}
            {!complete && firstIssue && <p className="text-alert">{boxIssueMessage(firstIssue, (id) => byId.get(id)?.name ?? "An item")}</p>}
            {!complete && !firstIssue && count < box.size && (
              <p className="text-ink-soft">
                Pick {box.size - count} more
                {untouched && (
                  <>
                    {" "}· nothing from{" "}
                    <Link href={hrefFor(bucketOf(untouched))} replace scroll={false} className="underline">
                      {nameOf(untouched)}
                    </Link>{" "}
                    yet?
                  </>
                )}
              </p>
            )}
            {added && <p className="font-semibold text-veg">Box added to your basket. Build another?</p>}
          </div>

          <button type="button" onClick={addBox} disabled={!complete || pending} className="btn btn-solid mt-3 w-full">
            {pending ? "Adding…" : cta}
          </button>
          {editing && (
            <Link href="/cart" className="mt-2 block text-center text-small underline">
              Back to basket
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
