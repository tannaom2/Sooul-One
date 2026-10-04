"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { formatPriceTag } from "@/lib/money";
import { boxIssues, boxIssueMessage, priceBox, type BoxRule } from "@/lib/checkout/boxes";
import type { BoxPage } from "@/server/boxes";
import type { ProductSummary } from "@/server/catalog";
import { useCart } from "@/components/basket/cart-provider";
import { ProductCard } from "@/components/ui";
import { BoxCarton } from "@/components/box-carton";
import { CLOSE_TIMELINE, MAX_SHOWN, cartonContents, flyDelta, type CartonPhase } from "@/lib/box-carton";
import { saveMyBox } from "@/app/account/saved-actions";

/**
 * The box page. The products are the site's standard product cards, with an
 * "Add to box" action underneath; the filter above them is the same tabs
 * (gummies) or chips (True Store) the shop pages use. A tray that stays in
 * view shows the slots filling, what the picks are worth and what the box
 * costs, and the carton above fills as packs drop in (src/components/box-carton.tsx).
 * Adding the box closes the carton, tapes it and flies it into the Basket
 * button while the basket saves it; if saving fails, the carton opens again. Picks are kept in this browser across tabs and refreshes until the
 * box goes in the basket, where the server checks everything again.
 */

type Picks = Record<string, number>;
type Editing = { cartBoxId: string; picks: { productId: string; quantity: number }[] } | null;
type Filter = { field: "brandSlug" | "categorySlug"; value: string | null; param: "brand" | "concern" };

const draftKey = (slug: string) => `soulone_box_${slug}`;
/** The two places the carton is drawn: under the title on phones, in the tray on wide screens. */
const PHONE_FRAME = { width: 300, height: 184, pad: 6 };
const TRAY_FRAME = { width: 286, height: 176, pad: 6 };
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, Math.max(0, ms)));
/** Milliseconds since `start`, for the closing animation's steps (called from the click handler only). */
const since = (start: number) => performance.now() - start;
const now = () => performance.now();
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
export function BoxBuilder(props: {
  box: BoxPage;
  kindLabel: string;
  editing: Editing;
  tabs: React.ReactNode;
  filter: Filter;
  /** Signed in: offer "Save this box for next time" once it's in the basket. */
  signedIn: boolean;
  /** Opened from a saved box on the account page (?saved=): start from its picks. */
  saved: { picks: { productId: string; quantity: number }[] } | null;
}) {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const { box, editing, saved } = props;
  let initial: Picks = {};
  if (editing) initial = Object.fromEntries(editing.picks.map((p) => [p.productId, p.quantity]));
  else if (saved) {
    const known = new Set(box.items.map((i) => i.id));
    initial = Object.fromEntries(saved.picks.filter((p) => known.has(p.productId)).map((p) => [p.productId, p.quantity]));
  } else if (hydrated) {
    const known = new Set(box.items.map((i) => i.id));
    initial = Object.fromEntries(Object.entries(readDraft(box.slug)).filter(([id, n]) => known.has(id) && n > 0));
  }
  return <Builder key={hydrated ? "client" : "server"} {...props} initial={initial} persist={hydrated && !editing && !saved} />;
}

function Builder({
  box,
  kindLabel,
  editing,
  tabs,
  filter,
  initial,
  persist,
  signedIn,
}: {
  box: BoxPage;
  kindLabel: string;
  editing: Editing;
  tabs: React.ReactNode;
  filter: Filter;
  initial: Picks;
  persist: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const { saveBox, openBasket, pending } = useCart();
  // The closing animation (addBox): its step, the flight to the Basket button,
  // and a moment with no transitions so the next empty box doesn't fly back.
  const [phase, setPhase] = useState<CartonPhase>("open");
  const [fly, setFly] = useState<{ x: number; y: number } | null>(null);
  const [vanish, setVanish] = useState(false);
  const [busy, setBusy] = useState(false);
  const phoneStage = useRef<HTMLDivElement>(null);
  const trayStage = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLElement>(null);

  // The Help button sits just above the tray while it's a bar along the bottom
  // (phones): the tray's height changes (a status line, the save form after
  // adding), so it's measured, not guessed (src/components/storefront-bot.tsx).
  useEffect(() => {
    const el = tray.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      if (getComputedStyle(el).position === "fixed") root.style.setProperty("--box-tray", `${Math.round(el.getBoundingClientRect().height)}px`);
      else root.style.removeProperty("--box-tray");
    };
    const watch = new ResizeObserver(update);
    watch.observe(el);
    window.addEventListener("resize", update);
    update();
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty("--box-tray");
    };
  }, []);
  const [picks, setPicks] = useState<Picks>(initial);
  const [added, setAdded] = useState(false);
  // The box just added, so it can still be saved after the tray empties.
  const [lastAdded, setLastAdded] = useState<{ productId: string; quantity: number }[] | null>(null);
  const [boxName, setBoxName] = useState(`My ${box.name}`);
  const [saveNote, setSaveNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

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
  const carton = cartonContents(pickList.map((p) => ({ picture: byId.get(p.productId)!.imageUrl, quantity: p.quantity })));
  const cartonProps = { packs: carton.shown, more: carton.more, complete: (complete && count > 0) || phase !== "open", spots: Math.min(box.size, MAX_SHOWN), animate: true, phase, fly, vanish };

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

  /** After the box is in the basket: start a fresh one, keeping this one to save for later. */
  function afterAdd() {
    try {
      localStorage.removeItem(draftKey(box.slug));
    } catch {}
    setLastAdded(pickList);
    setSaveNote(null);
    setPicks({});
    setAdded(true);
  }

  async function addBox() {
    if (busy) return;
    const still = editing || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      const ok = await saveBox({ boxId: box.id, picks: pickList, replaceCartBoxId: editing?.cartBoxId });
      if (!ok) return;
      if (editing) router.push("/cart");
      else afterAdd();
      return;
    }

    // Saved in the background while the carton closes; nothing waits on the animation.
    setBusy(true);
    const started = now();
    const until = (ms: number) => wait(ms - since(started));
    const saving = saveBox({ boxId: box.id, picks: pickList }, { open: false });
    setPhase("settle");
    await until(CLOSE_TIMELINE.closing);
    setPhase("closing");
    await until(CLOSE_TIMELINE.taped);
    setPhase("taped");
    if (!(await saving)) {
      // The basket opens with the reason; the box opens again so it can be fixed.
      setPhase("open");
      setBusy(false);
      return;
    }

    await until(CLOSE_TIMELINE.fly);
    const stage = [phoneStage.current, trayStage.current].find((el) => el && el.offsetParent !== null);
    const target = document.querySelector<HTMLElement>('header [aria-haspopup="dialog"]');
    const carton = stage?.firstElementChild;
    if (carton && target) {
      setFly(flyDelta(carton.getBoundingClientRect(), stage === phoneStage.current ? PHONE_FRAME : TRAY_FRAME, target.getBoundingClientRect()));
    }
    await until(CLOSE_TIMELINE.land);
    target?.animate([{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 320, easing: "ease-out" });

    setVanish(true);
    setFly(null);
    setPhase("open");
    afterAdd();
    openBasket();
    await wait(60);
    setVanish(false);
    setBusy(false);
  }

  async function saveForLater() {
    if (!lastAdded) return;
    setSaving(true);
    const result = await saveMyBox({ boxId: box.id, name: boxName, picks: lastAdded });
    setSaving(false);
    setSaveNote(result);
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
        {/* Phones and tablets; a wide screen has it in the tray beside the products. */}
        <div ref={phoneStage} className="mt-5 flex justify-center border border-rule bg-surface lg:hidden" style={{ borderRadius: "var(--radius-panel)" }}>
          <BoxCarton {...cartonProps} {...PHONE_FRAME} />
        </div>
      </header>

      {tabs}

      <div className="mx-auto max-w-6xl px-5 pt-6 lg:grid lg:grid-cols-[1fr_320px] lg:gap-10">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((item) => {
            const picked = picks[item.id] ?? 0;
            const leftToPick = item.availability.shippableUnits - picked;
            const canAdd = !busy && !full && picked < box.maxPerProduct && leftToPick > 0;
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
        {/* Raised over the page header while the box flies out of it to the Basket button. */}
        <aside ref={tray} className={`fixed inset-x-0 bottom-0 ${fly ? "z-[60]" : "z-40"} border-t border-rule bg-elevated px-5 pt-3 shadow-elevated lg:sticky lg:top-24 lg:self-start lg:border lg:p-4 lg:shadow-none`} style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", borderRadius: "var(--radius-panel)" }}>
          <div ref={trayStage} className="mb-3 hidden border border-rule bg-surface lg:block" style={{ borderRadius: "var(--radius-panel)" }}>
            <BoxCarton {...cartonProps} {...TRAY_FRAME} />
          </div>
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

          {/* Saved boxes (src/server/saved-boxes.ts): reorder this one in a tap from the account page. */}
          {added && lastAdded && !editing && (
            signedIn ? (
              saveNote?.ok ? (
                <p className="mt-2 text-micro text-veg">{saveNote.message}</p>
              ) : (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveForLater();
                  }}
                >
                  <label className="sr-only" htmlFor="saved-box-name">
                    Name for this box
                  </label>
                  <input id="saved-box-name" className="field min-w-0 flex-1 py-1.5 text-small" maxLength={60} value={boxName} onChange={(e) => setBoxName(e.target.value)} />
                  <button className="btn btn-outline shrink-0 py-1.5 text-small" disabled={saving}>
                    {saving ? "Saving…" : "Save for next time"}
                  </button>
                </form>
              )
            ) : (
              <p className="mt-2 text-micro text-ink-soft">
                <Link href="/account/sign-in" className="underline">Sign in</Link> to save boxes and reorder them in one tap.
              </p>
            )
          )}
          {saveNote && !saveNote.ok && <p className="mt-1 text-micro text-alert">{saveNote.message}</p>}

          <button type="button" onClick={addBox} disabled={!complete || pending || busy} className="btn btn-solid mt-3 w-full">
            {pending || busy ? "Adding…" : cta}
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
