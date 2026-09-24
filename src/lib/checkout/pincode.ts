/**
 * Pincode → city and state, from India Post's public directory
 * (api.postalpincode.in), normalised here. Pure, so the parsing is tested
 * without the network. The lookup itself lives in /api/pincode/[pin].
 *
 * The state decides CGST+SGST versus IGST on the invoice, so it comes from
 * the postal directory rather than a guess from the first digits, and the
 * shopper can still correct it.
 */

export interface PincodePlace {
  readonly city: string;
  readonly state: string;
}

export const PINCODE = /^[1-9]\d{5}$/;

/** India Post returns [{ Status, PostOffice: [{ District, State }, ...] }]. */
export function parsePostOffice(payload: unknown): PincodePlace | null {
  const first = Array.isArray(payload) ? payload[0] : null;
  if (!first || typeof first !== "object") return null;
  const { Status, PostOffice } = first as { Status?: unknown; PostOffice?: unknown };
  if (Status !== "Success" || !Array.isArray(PostOffice) || PostOffice.length === 0) return null;

  // Offices under one pincode share a district and state; take the most common
  // pair in case the directory lists a stray office from a neighbouring one.
  const counts = new Map<string, { place: PincodePlace; n: number }>();
  for (const office of PostOffice as { District?: unknown; State?: unknown }[]) {
    if (typeof office?.District !== "string" || typeof office?.State !== "string") continue;
    const place = { city: office.District.trim(), state: office.State.trim() };
    if (!place.city || !place.state) continue;
    const key = `${place.city}|${place.state}`;
    const entry = counts.get(key) ?? { place, n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  let best: { place: PincodePlace; n: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best?.place ?? null;
}
