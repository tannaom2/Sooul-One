/**
 * The home page's product rail (Sprint 3): the owner's Featured picks first,
 * then what sold most in the last 30 days by units, then the rest of the
 * catalogue so a new store's rail is never empty. Each product once. Ranked
 * from real orders only: nothing here is an invented "trending". Pure,
 * tested (tests/home-screen.test.ts).
 */

export const RAIL_SIZE = 10;
export const RAIL_DAYS = 30;

export function railOrder(
  input: { featured: readonly string[]; unitsSold: ReadonlyMap<string, number>; others: readonly string[] },
  limit = RAIL_SIZE,
): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (out.length < limit && !out.includes(id)) out.push(id);
  };
  input.featured.forEach(add);
  [...input.unitsSold.entries()].filter(([, units]) => units > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).forEach(([id]) => add(id));
  input.others.forEach(add);
  return out;
}
