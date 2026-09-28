import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { NoAccess } from "@/components/ui";
import { decimalToPaise, formatDate } from "@/lib/format";
import { formatPriceTag } from "@/lib/money";
import { boxKindLabel, boxKindOf, boxMargin } from "@/lib/checkout/boxes";
import { ActionForm } from "../action-form";
import { deleteBox, refreshPool, saveBoxDetails, saveBoxProducts, saveBoxRules, setBoxLive } from "../actions";

export const dynamic = "force-dynamic";

const num = (v: { toString(): string } | null) => (v == null ? "" : String(Number(v.toString())));

export default async function BoxEditor({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("bundles:write");
  if (!session) return <NoAccess />;
  const { id } = await params;

  const productSelect = {
    id: true,
    name: true,
    basePrice: true,
    unitCost: true,
    brand: { select: { name: true, slug: true } },
    category: { select: { name: true } },
  } as const;
  const [box, catalogue] = await Promise.all([
    db.box.findUnique({
      where: { id },
      include: {
        slots: { orderBy: { sortOrder: "asc" } },
        products: { include: { product: { select: productSelect } }, orderBy: { product: { name: "asc" } } },
      },
    }),
    db.product.findMany({ where: { isActive: true, retailOnly: false }, orderBy: { name: "asc" }, select: productSelect }),
  ]);
  if (!box) notFound();

  const seesCost = can(session.role, "finance:view");
  const inPool = box.products.filter((p) => !p.excluded);
  const margin = boxMargin(
    decimalToPaise(box.price),
    box.size,
    box.maxPerProduct,
    inPool.map((p) => ({ listPaise: decimalToPaise(p.product.basePrice), costPaise: p.product.unitCost == null ? null : decimalToPaise(p.product.unitCost) })),
  );
  // Every section carries the same rule; the first one shows it.
  const rule = box.slots[0];
  const hidden = (extra: Record<string, string> = {}) => (
    <>
      <input type="hidden" name="boxId" value={box.id} />
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );

  // The checklist, grouped the way the shopper filters: by sub-brand for gummies, by category for The True Store.
  const groupOf = (p: { brand: { name: string }; category: { name: string } }) => (box.kind === "GUMMIES" ? p.brand.name : p.category.name);
  const rowByProduct = new Map(box.products.map((p) => [p.productId, p]));
  const ofKind = catalogue.filter((p) => boxKindOf(p.brand.slug) === box.kind);
  const groups = [...new Set(ofKind.map(groupOf))].sort().map((name) => {
    const all = ofKind.filter((p) => groupOf(p) === name);
    return { name, fits: all.filter((p) => rowByProduct.has(p.id)), outside: all.filter((p) => !rowByProduct.has(p.id)) };
  });
  // Items priced above this make every box a saving on its own.
  const savingFloor = Math.ceil(Number(box.price) / box.size);
  const priceLine = (p: { basePrice: { toString(): string }; unitCost: { toString(): string } | null }) =>
    `${formatPriceTag(decimalToPaise(p.basePrice))}${seesCost && p.unitCost != null ? ` · cost ${formatPriceTag(decimalToPaise(p.unitCost))}` : ""}`;

  return (
    <div className="grid gap-8">
      <div>
        <Link href="/admin/boxes" className="text-small underline">
          ← All boxes
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-h2 font-extrabold">{box.name}</h1>
          <div className="flex flex-wrap items-center gap-3">
            {box.isActive && (
              <Link href={`/box/${box.slug}`} target="_blank" className="text-small underline">
                View on the storefront
              </Link>
            )}
            <ActionForm action={setBoxLive} submitLabel={box.isActive ? "Switch off" : "Put live"} variant={box.isActive ? "outline" : "solid"} className="flex items-center gap-3">
              {hidden({ live: String(!box.isActive) })}
            </ActionForm>
          </div>
        </div>
        <p className="mt-1 text-small">
          <span className="font-semibold">{boxKindLabel(box.kind)}</span>
          <span className={`font-semibold ${box.isActive ? "text-veg" : "text-ink-faint"}`}> · {box.isActive ? "Live on the storefront" : "Off"}</span>
        </p>
      </div>

      {/* What it costs the seller, before it goes live. */}
      <section className="panel">
        <div className="panel-head">Margin check</div>
        <dl className="grid gap-x-8 p-3.5 text-small sm:grid-cols-2">
          <div className="panel-row">
            <dt>Box value, cheapest to dearest</dt>
            <dd className="tabular">{margin.tooSmall ? "—" : `${formatPriceTag(margin.minValuePaise)} – ${formatPriceTag(margin.maxValuePaise)}`}</dd>
          </div>
          <div className="panel-row">
            <dt>Shopper saves</dt>
            <dd className="tabular">{margin.tooSmall ? "—" : `${margin.minDiscountPercent}% – ${margin.maxDiscountPercent}%`}</dd>
          </div>
          {seesCost && (
            <div className="panel-row sm:col-span-2">
              <dt>Worst-case margin (box price less the landed cost of the dearest box)</dt>
              <dd className={`tabular font-semibold ${margin.worstMarginPaise != null && margin.worstMarginPaise < 0 ? "text-alert" : ""}`}>
                {margin.tooSmall
                  ? "—"
                  : margin.worstMarginPaise == null
                    ? `Add landed cost to ${margin.itemsMissingCost} product${margin.itemsMissingCost === 1 ? "" : "s"} to see it`
                    : formatPriceTag(margin.worstMarginPaise)}
              </dd>
            </div>
          )}
        </dl>
        {margin.tooSmall && <p className="px-3.5 pb-3.5 text-small text-alert">The box can&rsquo;t be filled with {box.size} items yet.</p>}
      </section>

      <section className="panel">
        <div className="panel-head">Details</div>
        <ActionForm action={saveBoxDetails} submitLabel="Save details" className="grid gap-3 p-3.5 sm:grid-cols-2">
          {hidden()}
          <label className="grid gap-1 text-small">
            <span className="label">Name</span>
            <input name="name" className="field" defaultValue={box.name} required maxLength={80} />
          </label>
          <label className="grid gap-1 text-small">
            <span className="label">Description</span>
            <input name="description" className="field" defaultValue={box.description ?? ""} maxLength={300} />
          </label>
          <label className="grid gap-1 text-small">
            <span className="label">Box price (₹, incl. GST)</span>
            <input name="price" type="number" min={1} step="1" className="field" defaultValue={num(box.price)} required />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-small">
              <span className="label">Items per box</span>
              <input name="size" type="number" min={2} max={10} className="field" defaultValue={box.size} required />
            </label>
            <label className="grid gap-1 text-small">
              <span className="label">Same product at most</span>
              <input name="maxPerProduct" type="number" min={1} max={5} className="field" defaultValue={box.maxPerProduct} required />
            </label>
          </div>
          <label className="flex items-start gap-2 text-small sm:col-span-2">
            <input type="checkbox" name="allowBelowCost" defaultChecked={box.allowBelowCost} className="mt-1" />
            <span>Clearance override: allow this box to go live even if the dearest box would sell below landed cost. Logged.</span>
          </label>
        </ActionForm>
      </section>

      <section className="panel">
        <div className="panel-head">Which products</div>
        <ActionForm action={saveBoxRules} submitLabel="Save and refresh" className="grid gap-3 p-3.5">
          {hidden()}
          <p className="text-small text-ink-soft">
            Every {boxKindLabel(box.kind)} product priced in this range, in stock and shippable. Priced above {formatPriceTag(savingFloor * 100)}, every
            box of {box.size} is a saving at {formatPriceTag(decimalToPaise(box.price))}.
          </p>
          <div className="grid max-w-md grid-cols-2 gap-3">
            <label className="grid gap-1 text-small">
              <span className="label">Priced from ₹</span>
              <input name="minPrice" type="number" min={0} className="field" defaultValue={num(rule?.minPrice ?? null)} placeholder={String(savingFloor)} />
            </label>
            <label className="grid gap-1 text-small">
              <span className="label">to ₹</span>
              <input name="maxPrice" type="number" min={0} className="field" defaultValue={num(rule?.maxPrice ?? null)} placeholder="any" />
            </label>
          </div>
          <details className="text-small" open={rule?.mode === "CLEARANCE"}>
            <summary className="cursor-pointer font-semibold">Advanced: only stock worth clearing</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1">
                <span className="label">Which products</span>
                <select name="mode" defaultValue={rule?.mode ?? "ALL"} className="field">
                  <option value="ALL">Everything in the range</option>
                  <option value="CLEARANCE">Only stock worth clearing</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="label">Near cut-off within (days)</span>
                <input name="nearExpiryDays" type="number" min={0} className="field" defaultValue={rule?.nearExpiryDays ?? ""} placeholder="e.g. 45" />
              </label>
              <label className="grid gap-1">
                <span className="label">At least (days of stock)</span>
                <input name="minDaysOfCover" type="number" min={0} className="field" defaultValue={rule?.minDaysOfCover ?? ""} placeholder="e.g. 90" />
              </label>
            </div>
          </details>
        </ActionForm>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule p-3.5 text-small text-ink-soft">
          <span>
            {box.poolRefreshedAt ? `Refreshed ${formatDate(box.poolRefreshedAt)}` : "Not refreshed yet"}; it refreshes daily, so products come and go with
            stock.
          </span>
          <ActionForm action={refreshPool} submitLabel="Refresh now" variant="outline" className="flex items-center gap-3">
            {hidden()}
          </ActionForm>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head flex items-center justify-between">
          <span>Products in this box</span>
          <span className="text-micro font-normal text-ink-faint">
            {inPool.length} of {box.products.length} ticked
          </span>
        </div>
        <ActionForm action={saveBoxProducts} submitLabel="Save products" className="grid gap-4 p-3.5">
          {hidden()}
          <p className="text-small text-ink-soft">Untick a product to keep it out of this box; it stays out through refreshes until you tick it again.</p>
          {groups.map((g) => (
            <fieldset key={g.name} className="grid gap-1">
              <legend className="mb-1 text-small font-semibold">
                {g.name}{" "}
                <span className="font-normal text-ink-faint">
                  · {g.fits.length === 0 ? "none fit the rule" : `${g.fits.filter((p) => !rowByProduct.get(p.id)!.excluded).length} of ${g.fits.length}`}
                </span>
              </legend>
              {g.fits.map((p) => (
                <label key={p.id} className="flex items-start gap-2 py-1 text-small">
                  <input type="checkbox" name="productId" value={p.id} defaultChecked={!rowByProduct.get(p.id)!.excluded} className="mt-1" />
                  <span>
                    {p.name} <span className="text-micro text-ink-faint">· {priceLine(p)}</span>
                  </span>
                </label>
              ))}
              {g.outside.length > 0 && (
                <p className="text-micro text-ink-faint">
                  Outside the rule (price range, stock or clearance): {g.outside.map((p) => `${p.name} (${formatPriceTag(decimalToPaise(p.basePrice))})`).join(", ")}
                </p>
              )}
            </fieldset>
          ))}
          {groups.length === 0 && <p className="text-small text-ink-soft">No {boxKindLabel(box.kind)} products in the catalogue yet.</p>}
        </ActionForm>
      </section>

      <section className="panel border-alert">
        <div className="panel-head">Delete box</div>
        <ActionForm action={deleteBox} submitLabel="Delete this box" variant="outline" confirmText="Delete this box? Baskets holding it lose it. This can't be undone." className="flex items-center gap-3 p-3.5">
          {hidden()}
        </ActionForm>
      </section>
    </div>
  );
}
