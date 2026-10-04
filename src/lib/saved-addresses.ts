/**
 * The address book's rules (benchmark gap C16). Pure, tested
 * (tests/repeat-buying.test.ts); storage is src/server/saved-addresses.ts.
 */

/** Enough for home, work and family; the oldest unused one makes way. */
export const MAX_SAVED_ADDRESSES = 8;

export interface AddressFields {
  readonly name: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly phone: string;
}

const squash = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Two addresses are the same place when the street line, landmark and pincode
 * match, ignoring case, spaces and punctuation ("Flat 4, Shanti Nagar" is
 * "flat 4 shanti nagar"). The name can differ: a parcel for a parent still
 * goes to the same door.
 */
export function sameAddress(a: Pick<AddressFields, "line1" | "line2" | "postalCode">, b: Pick<AddressFields, "line1" | "line2" | "postalCode">): boolean {
  return squash(a.line1) === squash(b.line1) && squash(a.line2) === squash(b.line2) && a.postalCode.trim() === b.postalCode.trim();
}

/** One line for a picker or a list: "Asha Rao, Flat 4, Shanti Nagar, Ahmedabad 380015". */
export function addressSummary(a: Pick<AddressFields, "name" | "line1" | "line2" | "city" | "postalCode">): string {
  return [a.name, a.line1, a.line2, `${a.city} ${a.postalCode}`.trim()].filter((p) => p && p.trim()).join(", ");
}
