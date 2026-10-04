import type { BoxPick } from "@/lib/checkout/boxes";

/**
 * Saved boxes' rules (benchmark gap R4). Pure, tested
 * (tests/repeat-buying.test.ts); storage is src/server/saved-boxes.ts.
 */

export const MAX_SAVED_BOXES = 10;
export const MAX_BOX_NAME = 60;

/** The name as typed, tidied; the box's own name when left empty. */
export function cleanBoxName(name: string | null | undefined, fallback: string): string {
  const tidy = (name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_BOX_NAME);
  return tidy || fallback.slice(0, MAX_BOX_NAME);
}

/** The same picks, in any order: saving a box twice keeps one copy. */
export function samePicks(a: readonly BoxPick[], b: readonly BoxPick[]): boolean {
  const key = (picks: readonly BoxPick[]) =>
    picks
      .filter((p) => p.quantity > 0)
      .map((p) => `${p.productId}×${p.quantity}`)
      .sort()
      .join(",");
  return key(a) === key(b);
}

/** Picks from the stored JSON, keeping only well-formed ones. Never throws. */
export function parsePicks(json: unknown): BoxPick[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const { productId, quantity } = p as Record<string, unknown>;
    return typeof productId === "string" && productId && Number.isInteger(quantity) && (quantity as number) > 0 && (quantity as number) <= 10 ? [{ productId, quantity: quantity as number }] : [];
  });
}
