/**
 * Addresses that can never receive mail: the reserved test domains (RFC 2606
 * and RFC 6761) and the ones this project's tests use. Sending to them only
 * produces bounces, and bounces hurt the sender reputation every real order
 * confirmation depends on. Pure, so it's tested directly.
 */
const RESERVED = /@(?:[a-z0-9-]+\.)*(?:test|example|invalid|localhost)$|@(?:[a-z0-9-]+\.)*example\.(?:com|net|org|in)$/i;

export function isUndeliverableTestAddress(email: string): boolean {
  return RESERVED.test(email.trim());
}
