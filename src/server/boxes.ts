import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { CATALOG_TAG } from "@/lib/cache-tags";
import { decimalToPaise } from "@/lib/format";
import { resolveUnitPrice } from "@/lib/pricing";
import { SELLABLE_PRODUCT_WHERE, isSellable } from "@/lib/basket-rules";
import { productAvailability } from "@/lib/checkout/availability";
import { SLOWEST_SERVED_ZONE, estimateDeliveryDate } from "@/lib/checkout/delivery";
import { EXPIRY_ONLY_POLICY, FSSAI_ECOMMERCE_POLICY, requiredRemainingDays, wholeDaysBetween } from "@/lib/compliance/shelf-life";
import { boxIssues, boxIssueMessage, boxKindOf, slotTakes, wrongKindMessage, type BoxKind, type BoxPick, type BoxRule, type ProductFacts } from "@/lib/checkout/boxes";
import { getProductSummaries, type ProductSummary } from "@/server/catalog";

/**
 * Make Your Own Box, the database side: the pool refresh, the box page's
 * data, and boxes in the basket. The rules are in src/lib/checkout/boxes.ts.
 */

/** Orders that count as sales for "slow-selling". */
const SELLING_STATUSES = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as const;
const SALES_WINDOW_DAYS = 30;

type BoxWithRules = {
  id: string;
  name: string;
  size: number;
  price: { toString(): string };
  maxPerProduct: number;
  slots: { id: string; label: string; minPicks: number; maxPicks: number | null }[];
  products: { productId: string; slotId: string; excluded: boolean }[];
};

/** The rule the basket and checkout check a box against. */
export function boxRuleOf(box: BoxWithRules): BoxRule {
  return {
    id: box.id,
    name: box.name,
    size: box.size,
    pricePaise: decimalToPaise(box.price),
    maxPerProduct: box.maxPerProduct,
    slots: box.slots.map((s) => ({ id: s.id, label: s.label, minPicks: s.minPicks, maxPicks: s.maxPicks })),
    eligible: new Map(box.products.filter((p) => !p.excluded).map((p) => [p.productId, p.slotId])),
  };
}

const BOX_RULE_INCLUDE = {
  slots: { orderBy: { sortOrder: "asc" as const } },
  products: { select: { productId: true, slotId: true, excluded: true } },
};

/** Days until the first batch we'd send can no longer ship, or null when not batch-tracked. */
function daysToCutoff(
  product: { shelfLifeDays: number | null; batches: { expiresOn: Date; quantityRemaining: number }[] },
  delivery: Date,
): number | null {
  if (product.batches.length === 0) return null;
  const policy = product.shelfLifeDays ? FSSAI_ECOMMERCE_POLICY : EXPIRY_ONLY_POLICY;
  const required = requiredRemainingDays(product.shelfLifeDays ?? 1, policy);
  const batches = [...product.batches].filter((b) => b.quantityRemaining > 0).sort((a, b) => a.expiresOn.getTime() - b.expiresOn.getTime());
  for (const b of batches) {
    const left = wholeDaysBetween(delivery, new Date(b.expiresOn));
    if (left >= required) return left - required;
  }
  return null;
}

/**
 * Rebuild a box's pool from its sections' rules. A product goes to the first
 * section (in page order) whose rule takes it. The owner's pins and
 * exclusions are kept as they are; everything the rules picked last time is
 * replaced.
 */
export async function refreshBoxPool(boxId: string): Promise<{ inPool: number; bySlot: Record<string, number> }> {
  const box = await db.box.findUnique({ where: { id: boxId }, include: { slots: { orderBy: { sortOrder: "asc" } }, products: true } });
  if (!box) throw new Error("That box no longer exists.");

  const now = new Date();
  const delivery = estimateDeliveryDate(now, SLOWEST_SERVED_ZONE);
  const since = new Date(now.getTime() - SALES_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [products, sales] = await Promise.all([
    db.product.findMany({
      where: { ...SELLABLE_PRODUCT_WHERE, retailOnly: false },
      include: { brand: { select: { slug: true } }, batches: { where: { quantityRemaining: { gt: 0 } } } },
    }),
    db.orderItem.groupBy({
      by: ["productId"],
      where: { order: { placedAt: { gte: since }, status: { in: [...SELLING_STATUSES] } } },
      _sum: { quantity: true },
    }),
  ]);
  const soldBy = new Map(sales.map((s) => [s.productId, s._sum.quantity ?? 0]));
  const kept = new Map(box.products.filter((p) => p.source === "MANUAL" || p.excluded).map((p) => [p.productId, p]));

  const picked: { productId: string; slotId: string; reason: string }[] = [];
  for (const p of products) {
    if (kept.has(p.id)) continue;
    // Gummies boxes take only gummies, True Store boxes only snacks.
    if (boxKindOf(p.brand.slug) !== box.kind) continue;
    const facts: ProductFacts = {
      brandId: p.brandId,
      categoryId: p.categoryId,
      listPaise: decimalToPaise(p.basePrice),
      shippableUnits: productAvailability(p, delivery).shippableUnits,
      daysToCutoff: daysToCutoff(p, delivery),
      dailySales: (soldBy.get(p.id) ?? 0) / SALES_WINDOW_DAYS,
    };
    for (const slot of box.slots) {
      const reason = slotTakes(
        {
          brandIds: slot.brandIds,
          categoryIds: slot.categoryIds,
          minPricePaise: slot.minPrice == null ? null : decimalToPaise(slot.minPrice),
          maxPricePaise: slot.maxPrice == null ? null : decimalToPaise(slot.maxPrice),
          mode: slot.mode,
          nearExpiryDays: slot.nearExpiryDays,
          minDaysOfCover: slot.minDaysOfCover,
        },
        facts,
      );
      if (reason) {
        picked.push({ productId: p.id, slotId: slot.id, reason });
        break;
      }
    }
  }

  await db.$transaction([
    db.boxProduct.deleteMany({ where: { boxId, source: "RULE", excluded: false } }),
    db.boxProduct.createMany({ data: picked.map((p) => ({ boxId, ...p, source: "RULE" as const, refreshedAt: now })), skipDuplicates: true }),
    db.box.update({ where: { id: boxId }, data: { poolRefreshedAt: now } }),
  ]);

  const bySlot: Record<string, number> = {};
  for (const p of [...picked, ...[...kept.values()].filter((k) => !k.excluded)]) bySlot[p.slotId] = (bySlot[p.slotId] ?? 0) + 1;
  return { inPool: Object.values(bySlot).reduce((a, b) => a + b, 0), bySlot };
}

/** Live boxes for the header and home page: cached with the catalogue. */
export const activeBoxes = unstable_cache(
  async () => db.box.findMany({ where: { isActive: true }, select: { slug: true, name: true, kind: true, size: true, price: true }, orderBy: { createdAt: "asc" } }),
  ["active-boxes"],
  { tags: [CATALOG_TAG], revalidate: 300 },
);

export interface BoxPage {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: BoxKind;
  readonly description: string | null;
  readonly pricePaise: number;
  readonly size: number;
  readonly maxPerProduct: number;
  readonly slots: readonly { id: string; label: string; minPicks: number; maxPicks: number | null }[];
  /** Every product the box can take right now, as the standard product card shows it. */
  readonly items: readonly ProductSummary[];
  /** Product id → its section, for section minimums. */
  readonly slotOf: Readonly<Record<string, string>>;
}

/**
 * Everything the box page shows: the box, and each in-stock product in its pool.
 * Cached like the catalogue (5 minutes, dropped at once when an order, the
 * daily refresh or an owner's change touches stock or boxes), so a box page
 * costs no database round trips on most visits. Stock is re-checked when the
 * box goes in the basket and again at checkout.
 */
export const boxPage = unstable_cache(loadBoxPage, ["box-page"], { revalidate: 300, tags: [CATALOG_TAG] });

async function loadBoxPage(slug: string): Promise<BoxPage | null> {
  // A live box that has never been refreshed (made by a script, say) fills its
  // pool the first time anyone looks; after that the daily refresh keeps it current.
  const meta = await db.box.findUnique({ where: { slug }, select: { id: true, isActive: true, poolRefreshedAt: true } });
  if (meta?.isActive && !meta.poolRefreshedAt) await refreshBoxPool(meta.id);
  const box = await db.box.findUnique({
    where: { slug },
    include: { slots: { orderBy: { sortOrder: "asc" } }, products: { where: { excluded: false }, select: { productId: true, slotId: true } } },
  });
  if (!box || !box.isActive) return null;

  const summaries = await getProductSummaries(box.products.map((p) => p.productId));
  const items = summaries
    .filter((p) => !p.retailOnly && p.availability.state !== "out" && boxKindOf(p.brandSlug) === box.kind)
    .sort((a, b) => a.brandName.localeCompare(b.brandName) || a.name.localeCompare(b.name));

  return {
    id: box.id,
    slug: box.slug,
    name: box.name,
    kind: box.kind,
    description: box.description,
    pricePaise: decimalToPaise(box.price),
    size: box.size,
    maxPerProduct: box.maxPerProduct,
    slots: box.slots.map((s) => ({ id: s.id, label: s.label, minPicks: s.minPicks, maxPicks: s.maxPicks })),
    items,
    slotOf: Object.fromEntries(box.products.map((p) => [p.productId, p.slotId])),
  };
}

/**
 * Put a finished box in the basket, or replace one being edited. Checked
 * against the box's rules and live stock first, so nothing half-valid goes in.
 */
export async function saveCartBox(
  sessionId: string,
  input: { boxId: string; picks: readonly BoxPick[]; replaceCartBoxId?: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const box = await db.box.findUnique({ where: { id: input.boxId }, include: BOX_RULE_INCLUDE });
  if (!box || !box.isActive) return { ok: false, message: "This box isn't available any more." };
  const picks = input.picks.filter((p) => p.quantity > 0);
  const rule = boxRuleOf(box);

  const products = await db.product.findMany({
    where: { id: { in: picks.map((p) => p.productId) } },
    include: { brand: { select: { isActive: true, slug: true } }, category: { select: { isActive: true } }, batches: { where: { quantityRemaining: { gt: 0 } } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  // Never a snack in a gummies box or a gummy in a True Store box, whatever the page sent.
  const stranger = products.find((p) => boxKindOf(p.brand.slug) !== box.kind);
  if (stranger) return { ok: false, message: wrongKindMessage(box.kind, stranger.name) };
  const issues = boxIssues(rule, picks);
  if (issues.length > 0) return { ok: false, message: boxIssueMessage(issues[0], (id) => byId.get(id)?.name ?? "An item") };

  const delivery = estimateDeliveryDate(new Date(), SLOWEST_SERVED_ZONE);
  for (const pick of picks) {
    const p = byId.get(pick.productId);
    if (!p || !isSellable(p) || p.retailOnly || productAvailability(p, delivery).shippableUnits < pick.quantity) {
      return { ok: false, message: `${p?.name ?? "One of your picks"} has just sold out. Swap it for another.` };
    }
  }

  const cart = await db.cart.upsert({ where: { sessionId }, create: { sessionId }, update: {} });
  await db.$transaction(async (tx) => {
    if (input.replaceCartBoxId) await tx.cartBox.deleteMany({ where: { id: input.replaceCartBoxId, cartId: cart.id } });
    await tx.cartBox.create({
      data: { cartId: cart.id, boxId: box.id, items: { create: picks.map((p) => ({ productId: p.productId, quantity: p.quantity })) } },
    });
  });
  return { ok: true };
}

export async function removeCartBox(sessionId: string, cartBoxId: string): Promise<void> {
  await db.cartBox.deleteMany({ where: { id: cartBoxId, cart: { sessionId } } });
}

/** A box in this basket, for editing it on the box page. */
export async function cartBoxPicks(sessionId: string, cartBoxId: string): Promise<{ boxId: string; picks: BoxPick[] } | null> {
  const found = await db.cartBox.findFirst({ where: { id: cartBoxId, cart: { sessionId } }, include: { items: true } });
  return found ? { boxId: found.boxId, picks: found.items.map((i) => ({ productId: i.productId, quantity: i.quantity })) } : null;
}

export { BOX_RULE_INCLUDE };
