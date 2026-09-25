import { lintSupplementCopy } from "@/lib/compliance/claims";

/**
 * Rules for a category's name and description (Admin → Categories).
 *
 * Category names are passed to the supplement claims check as allowed phrases
 * (a "Hair Fall" category may say "hair fall" in its products' copy), so a
 * name must pass that check itself. Otherwise a category called "Cures hair
 * loss" would whitelist a banned claim across every product in it.
 */

export interface CategoryInput {
  readonly name: string;
  readonly description: string | null;
  readonly sortOrder: number;
}

export type CategoryCheck = { ok: true; value: CategoryInput } | { ok: false; message: string };

export function checkCategory(raw: { name: string; description: string; sortOrder: string }): CategoryCheck {
  const name = raw.name.trim().replace(/\s+/g, " ");
  const description = raw.description.trim() || null;
  if (name.length < 2 || name.length > 60) return { ok: false, message: "Give the category a name of 2 to 60 characters." };
  if (description && description.length > 500) return { ok: false, message: "Keep the description under 500 characters." };

  const sort = raw.sortOrder.trim() === "" ? 0 : Number(raw.sortOrder);
  if (!Number.isInteger(sort) || sort < 0 || sort > 999) return { ok: false, message: "Position must be a whole number from 0 to 999." };

  const claims = lintSupplementCopy(`${name}\n${description ?? ""}`);
  if (claims.blockingCount > 0) {
    const words = [...new Set(claims.findings.filter((f) => f.severity === "BLOCK").map((f) => `"${f.matchedText}"`))];
    return {
      ok: false,
      message: `${words.join(", ")} reads as a medical claim, which supplements can't make. Name the need, not a cure (e.g. "Hair Fall", not "Cures hair loss").`,
    };
  }
  return { ok: true, value: { name, description, sortOrder: sort } };
}

/** The category's web address part. Fixed at creation so links keep working. */
export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
