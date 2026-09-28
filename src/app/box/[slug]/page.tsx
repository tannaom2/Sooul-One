import { notFound } from "next/navigation";
import { boxPage, cartBoxPicks } from "@/server/boxes";
import { readSessionId } from "@/server/cart";
import { formatPriceTag } from "@/lib/money";
import { boxKindLabel } from "@/lib/checkout/boxes";
import { GummyBrandTabs } from "@/components/gummy-brand-tabs";
import { ConcernChips } from "@/components/concern-chips";
import { BRAND_ACCENT } from "@/components/ui";
import { BoxBuilder } from "./box-builder";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const box = await boxPage((await params).slug);
  return box
    ? { title: `${box.name}: any ${box.size} for ${formatPriceTag(box.pricePaise)} — SooulOne`, description: box.description ?? undefined }
    : { title: "Box not found — SooulOne" };
}

/**
 * Make Your Own Box: pick any N products for one price, from a Box of Gummies
 * (filtered by sub-brand, with the Gummies page's own tabs) or a True Store
 * box (filtered by category, with the True Store page's own chips).
 * `?edit=<cartBoxId>` reopens a box already in the basket with its picks.
 */
export default async function BoxPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ edit?: string; brand?: string; concern?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const box = await boxPage(slug);
  if (!box) notFound();

  let editing: { cartBoxId: string; picks: { productId: string; quantity: number }[] } | null = null;
  if (query.edit) {
    const sessionId = await readSessionId();
    const found = sessionId ? await cartBoxPicks(sessionId, query.edit) : null;
    if (found && found.boxId === box.id) editing = { cartBoxId: query.edit, picks: found.picks };
  }

  // The filter keeps the edit in progress in the address, so switching tabs never loses it.
  const param = box.kind === "GUMMIES" ? "brand" : "concern";
  const hrefFor = (value: string | null) => {
    const q = new URLSearchParams();
    if (editing) q.set("edit", editing.cartBoxId);
    if (value) q.set(param, value);
    const s = q.toString();
    return `/box/${box.slug}${s ? `?${s}` : ""}`;
  };
  const categories = [...new Map(box.items.map((i) => [i.categorySlug, i.categoryName])).entries()].map(([s, name]) => ({
    slug: s,
    name,
    count: box.items.filter((i) => i.categorySlug === s).length,
  }));
  const active = (box.kind === "GUMMIES" ? query.brand : query.concern) ?? null;
  const tabs =
    box.kind === "GUMMIES" ? (
      <GummyBrandTabs active={active} hrefFor={hrefFor} refine />
    ) : (
      <ConcernChips
        label="Shop by category"
        basePath={`/box/${box.slug}`}
        options={categories}
        active={active}
        total={box.items.length}
        accent={BRAND_ACCENT["the-true-store"]}
        hrefFor={hrefFor}
      />
    );

  return (
    <BoxBuilder
      box={box}
      kindLabel={boxKindLabel(box.kind)}
      editing={editing}
      tabs={tabs}
      filter={{ field: box.kind === "GUMMIES" ? "brandSlug" : "categorySlug", value: active, param }}
    />
  );
}
