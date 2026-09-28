import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { decimalToPaise, formatDate } from "@/lib/format";
import { formatPriceTag } from "@/lib/money";
import { reportError } from "@/lib/observability";
import { BOX_KINDS, boxKindLabel } from "@/lib/checkout/boxes";
import { ActionForm } from "./action-form";
import { createBox } from "./actions";

export const dynamic = "force-dynamic";

export default async function BoxesPage() {
  const session = await requirePermission("bundles:write");
  if (!session) return <NoAccess />;

  let boxes;
  try {
    boxes = await db.box.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { products: { where: { excluded: false } }, cartBoxes: true } } },
    });
  } catch (error) {
    reportError("admin/boxes", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Make your own box</h1>
        <p className="mt-2 max-w-[64ch] text-ink-soft">
          A fixed price for any N products the shopper picks. A box is a Box of Gummies (Woman Axis, Man Rituals, Kids Vault) or a
          True Store box (snacks), never both. It takes that type&rsquo;s products in a price range, refreshed daily; you can
          untick any product to keep it out.
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">New box</div>
        <ActionForm action={createBox} submitLabel="Create box" className="grid gap-3 p-3.5 sm:grid-cols-2">
          <label className="grid gap-1 text-small">
            <span className="label">Box type</span>
            <select name="kind" className="field" defaultValue="GUMMIES" required>
              {BOX_KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-small">
            <span className="label">Name</span>
            <input name="name" className="field" placeholder="Gummies Box" required maxLength={80} />
          </label>
          <label className="grid gap-1 text-small">
            <span className="label">Description (optional)</span>
            <input name="description" className="field" placeholder="Something for everyone at home." maxLength={300} />
          </label>
          <label className="grid gap-1 text-small">
            <span className="label">Box price (₹, incl. GST)</span>
            <input name="price" type="number" min={1} step="1" className="field" defaultValue={999} required />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-small">
              <span className="label">Items per box</span>
              <input name="size" type="number" min={2} max={10} className="field" defaultValue={3} required />
            </label>
            <label className="grid gap-1 text-small">
              <span className="label">Same product at most</span>
              <input name="maxPerProduct" type="number" min={1} max={5} className="field" defaultValue={1} required />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-small">
              <span className="label">Products priced from ₹</span>
              <input name="minPrice" type="number" min={0} className="field" placeholder="any" />
            </label>
            <label className="grid gap-1 text-small">
              <span className="label">to ₹</span>
              <input name="maxPrice" type="number" min={0} className="field" placeholder="any" />
            </label>
          </div>
          <p className="self-end text-micro text-ink-faint">
            Tip: start the range above the box price ÷ items per box (₹333 for 3 at ₹999), so every box is a saving.
          </p>
          <p className="text-micro text-ink-faint sm:col-span-2">
            New boxes start switched off, so you can untick products and check the margin first. The type can&rsquo;t change later.
          </p>
        </ActionForm>
      </div>

      {boxes.length === 0 ? (
        <Empty title="No boxes yet" detail="Create one above." />
      ) : (
        <div className="grid gap-3">
          {boxes.map((b) => (
            <Link key={b.id} href={`/admin/boxes/${b.id}`} className={`panel block hover:border-strong ${b.isActive ? "" : "bg-shelf"}`}>
              <div className="panel-head flex flex-wrap items-center justify-between gap-2">
                <span>{b.name}</span>
                <span className={`text-micro font-semibold ${b.isActive ? "text-veg" : "text-ink-faint"}`}>{b.isActive ? "Live" : "Off"}</span>
              </div>
              <p className="p-3.5 text-small text-ink-soft">
                {boxKindLabel(b.kind)} · any {b.size} for {formatPriceTag(decimalToPaise(b.price))} · {b._count.products} product{b._count.products === 1 ? "" : "s"}
                {b._count.cartBoxes > 0 && ` · in ${b._count.cartBoxes} baskets`}
                {b.poolRefreshedAt && ` · refreshed ${formatDate(b.poolRefreshedAt)}`}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
