/**
 * Storefront search across every brand at once. One catalogue, so a shopper
 * on Woman Axis who types "biotin" also sees a Man Rituals match, grouped
 * under its brand. Pure, so ranking is tested (tests/search.test.ts);
 * src/server/search.ts feeds it the cached catalogue.
 *
 * The catalogue is small (tens of products), so it's scored in memory:
 * word-prefix matches, with one typo forgiven on longer words
 * ("ashwagnadha" still finds ashwagandha). Every word typed must match
 * somewhere; if nothing matches all of them, results that match any word are
 * shown instead, marked as close matches.
 */

const STOP = new Set(["a", "an", "and", "the", "for", "of", "in", "with", "to", "on", "my", "me", "i", "is", "are", "best", "buy", "online"]);

export function tokenize(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((t) => t.length > 0 && !STOP.has(t)),
    ),
  ].slice(0, 8);
}

/** Within one edit (insert, delete, substitute or swap two neighbours). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // swap
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

const words = (text: string) => tokenize(text);

/** How well one query word matches a field's words: 1 exact or prefix, 0.6 one typo away, else 0. */
function wordScore(token: string, fieldWords: readonly string[]): number {
  let best = 0;
  for (const w of fieldWords) {
    if (w === token || (token.length >= 2 && w.startsWith(token))) return 1;
    if (token.length >= 5 && w.length >= 4 && (withinOneEdit(token, w) || withinOneEdit(token, w.slice(0, token.length)))) best = 0.6;
  }
  return best;
}

export interface Searchable {
  readonly id: string;
  /** Weighted fields: the name counts most. */
  readonly name: string;
  readonly brand?: string;
  readonly category?: string;
  readonly text?: string;
}

const WEIGHTS = { name: 6, brand: 4, category: 4, text: 2 } as const;

/** A score for one item, and whether every token matched something. */
export function scoreItem(tokens: readonly string[], item: Searchable): { score: number; all: boolean } {
  const fields = {
    name: words(item.name),
    brand: words(item.brand ?? ""),
    category: words(item.category ?? ""),
    text: words(item.text ?? ""),
  };
  let score = 0;
  let all = true;
  for (const t of tokens) {
    let best = 0;
    for (const f of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) best = Math.max(best, wordScore(t, fields[f]) * WEIGHTS[f]);
    if (best === 0) all = false;
    score += best;
  }
  return { score, all };
}

/** Items ranked for a query. `close` is true when nothing matched every word, so any-word matches are shown. */
export function rank<T extends Searchable>(q: string, items: readonly T[]): { hits: T[]; close: boolean } {
  const tokens = tokenize(q);
  if (tokens.length === 0) return { hits: [], close: false };
  const scored = items.map((item) => ({ item, ...scoreItem(tokens, item) })).filter((s) => s.score > 0);
  const strict = scored.filter((s) => s.all);
  const pool = strict.length > 0 ? strict : scored;
  return {
    hits: pool.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).map((s) => s.item),
    close: strict.length === 0 && pool.length > 0,
  };
}

/**
 * Product hits grouped by brand: the brand the shopper is browsing first,
 * then the others in order of their best hit.
 */
export function groupByBrand<T extends { brandSlug: string; brandName: string }>(hits: readonly T[], currentBrand: string | null): { brandSlug: string; brandName: string; items: T[] }[] {
  const groups: { brandSlug: string; brandName: string; items: T[] }[] = [];
  for (const h of hits) {
    let g = groups.find((x) => x.brandSlug === h.brandSlug);
    if (!g) groups.push((g = { brandSlug: h.brandSlug, brandName: h.brandName, items: [] }));
    g.items.push(h);
  }
  const i = groups.findIndex((g) => g.brandSlug === currentBrand);
  if (i > 0) groups.unshift(...groups.splice(i, 1));
  return groups;
}

/**
 * The query as kept in analytics: lower case, no email addresses and no runs
 * of four or more digits (phone numbers, order numbers), at most 60 characters.
 */
export function queryForLog(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\s@]+@[^\s@]+/g, " ")
    .replace(/\d{4,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
