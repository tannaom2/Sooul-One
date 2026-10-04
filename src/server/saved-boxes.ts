import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { boxIssues, type BoxPick } from "@/lib/checkout/boxes";
import { MAX_SAVED_BOXES, cleanBoxName, parsePicks, samePicks } from "@/lib/saved-boxes";
import { BOX_RULE_INCLUDE, boxRuleOf } from "@/server/boxes";

/**
 * Saved boxes (benchmark gap R4): a signed-in shopper names a finished Make
 * Your Own Box and puts it in the basket again from their account in one
 * tap. Saving only checks the box is complete; stock and the box's current
 * rules are checked when it goes in the basket (saveCartBox), so a sold-out
 * pick is caught then, with a link to swap it in the box builder.
 */

export async function saveBoxForCustomer(
  customerId: string,
  input: { boxId: string; name: string; picks: readonly BoxPick[] },
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const box = await db.box.findUnique({ where: { id: input.boxId }, include: BOX_RULE_INCLUDE });
  if (!box || !box.isActive) return { ok: false, message: "This box isn't available any more." };
  const picks = input.picks.filter((p) => p.quantity > 0);
  if (boxIssues(boxRuleOf(box), picks).length > 0) return { ok: false, message: `Fill the box (${box.size} picks) before saving it.` };
  // Saved already (from the box page and again from the basket, say): keep the one copy.
  const existing = await db.savedBox.findMany({ where: { customerId, boxId: box.id }, select: { id: true, picks: true } });
  const twin = existing.find((s) => samePicks(parsePicks(s.picks), picks));
  if (twin) return { ok: true, id: twin.id };
  const count = await db.savedBox.count({ where: { customerId } });
  if (count >= MAX_SAVED_BOXES) return { ok: false, message: `You have ${MAX_SAVED_BOXES} saved boxes. Remove one from your account to save another.` };
  const saved = await db.savedBox.create({
    data: { customerId, boxId: box.id, name: cleanBoxName(input.name, box.name), picks: picks.map((p) => ({ productId: p.productId, quantity: p.quantity })) as Prisma.InputJsonArray },
  });
  return { ok: true, id: saved.id };
}

export interface SavedBoxView {
  readonly id: string;
  readonly name: string;
  readonly boxId: string;
  readonly boxName: string;
  readonly boxSlug: string;
  readonly available: boolean;
  readonly picks: readonly BoxPick[];
  readonly items: readonly { name: string; imageUrl: string | null; quantity: number }[];
}

/** This shopper's saved boxes, newest first, with what's in each. */
export async function savedBoxes(customerId: string): Promise<SavedBoxView[]> {
  const rows = await db.savedBox.findMany({ where: { customerId }, orderBy: { updatedAt: "desc" }, include: { box: { select: { name: true, slug: true, isActive: true } } } });
  const picksById = new Map(rows.map((r) => [r.id, parsePicks(r.picks)]));
  const ids = [...new Set([...picksById.values()].flat().map((p) => p.productId))];
  const products = ids.length ? await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } } } }) : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  return rows.map((r) => {
    const picks = picksById.get(r.id) ?? [];
    return {
      id: r.id,
      name: r.name,
      boxId: r.boxId,
      boxName: r.box.name,
      boxSlug: r.box.slug,
      available: r.box.isActive,
      picks,
      items: picks.map((p) => ({ name: byId.get(p.productId)?.name ?? "A product no longer sold", imageUrl: byId.get(p.productId)?.images[0]?.url ?? null, quantity: p.quantity })),
    };
  });
}

/** One saved box's picks, for reopening it in the box builder. */
export async function savedBoxPicks(customerId: string, savedBoxId: string): Promise<{ boxId: string; picks: BoxPick[] } | null> {
  const row = await db.savedBox.findFirst({ where: { id: savedBoxId, customerId }, select: { boxId: true, picks: true } });
  return row ? { boxId: row.boxId, picks: parsePicks(row.picks) } : null;
}

export async function removeSavedBox(customerId: string, savedBoxId: string): Promise<boolean> {
  const { count } = await db.savedBox.deleteMany({ where: { id: savedBoxId, customerId } });
  return count === 1;
}
