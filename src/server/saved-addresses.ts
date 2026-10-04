import "server-only";
import { db } from "@/lib/db";
import { MAX_SAVED_ADDRESSES, sameAddress, type AddressFields } from "@/lib/saved-addresses";

/**
 * A signed-in shopper's address book (benchmark gap C16). Each order they
 * place saves its delivery address, or marks a saved one as just used, so
 * checkout can offer it next time. Shoppers remove addresses from their
 * account page. Guests have no address book.
 */

export interface SavedAddress extends AddressFields {
  readonly id: string;
}

const SELECT = { id: true, name: true, line1: true, line2: true, city: true, state: true, postalCode: true, phone: true } as const;

/** The book, most recently used first. */
export async function savedAddresses(customerId: string): Promise<SavedAddress[]> {
  return db.address.findMany({ where: { customerId }, orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], select: SELECT, take: MAX_SAVED_ADDRESSES });
}

/**
 * Save the address an order went to. A place already in the book is updated
 * (the name and phone may have changed) and moved to the top; a new one is
 * added, and when the book is full the least recently used one makes way.
 */
export async function rememberAddress(customerId: string, address: AddressFields, now = new Date()): Promise<void> {
  const book = await db.address.findMany({ where: { customerId }, orderBy: [{ lastUsedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }], select: { id: true, line1: true, line2: true, postalCode: true } });
  const fields = { name: address.name, line1: address.line1, line2: address.line2 || null, city: address.city, state: address.state, postalCode: address.postalCode, phone: address.phone, lastUsedAt: now };
  const known = book.find((a) => sameAddress(a, { line1: address.line1, line2: address.line2, postalCode: address.postalCode }));
  if (known) {
    await db.address.update({ where: { id: known.id }, data: fields });
    return;
  }
  const overflow = book.length - MAX_SAVED_ADDRESSES + 1;
  await db.$transaction([
    ...(overflow > 0 ? [db.address.deleteMany({ where: { id: { in: book.slice(0, overflow).map((a) => a.id) } } })] : []),
    db.address.create({ data: { customerId, ...fields } }),
  ]);
}

/** Remove one of this shopper's addresses. Someone else's id does nothing. */
export async function forgetAddress(customerId: string, addressId: string): Promise<boolean> {
  const { count } = await db.address.deleteMany({ where: { id: addressId, customerId } });
  return count === 1;
}
