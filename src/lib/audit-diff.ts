/**
 * Field-level before/after for the audit log: only fields that actually
 * changed, as { field: { from, to } }.
 *
 * Values are normalised before comparing, because the same number arrives as
 * a Prisma Decimal from the database and as a string or number from a form —
 * without this, every save would report the price as "changed" from 100 to
 * "100". Pure, so it's unit-tested.
 */

export type FieldChange = { from: unknown; to: unknown };
export type ChangeSet = Record<string, FieldChange>;

function normalise(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value;
  if (typeof value === "object") {
    // Prisma Decimal (and anything with a meaningful toString) → its string form.
    const s = String(value);
    if (s !== "[object Object]") return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
    return JSON.stringify(value);
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return value;
}

function equal(a: unknown, b: unknown): boolean {
  const na = normalise(a);
  const nb = normalise(b);
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return na === nb;
}

/**
 * Compare `after` against `before`, over the keys of `after` (the fields the
 * edit actually wrote). Returns only changed fields.
 */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): ChangeSet {
  const changes: ChangeSet = {};
  for (const key of Object.keys(after)) {
    if (!equal(before[key], after[key])) {
      changes[key] = { from: normalise(before[key]), to: normalise(after[key]) };
    }
  }
  return changes;
}
