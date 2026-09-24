import { randomBytes, timingSafeEqual } from "node:crypto";

/** 128 bits of randomness, URL-safe. */
export function newOrderAccessToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * The customer's private link to their order page, for emails. Null for
 * orders placed before tokens existed, so no email ever carries a link
 * that would only 404.
 */
export function orderStatusUrl(
  orderNumber: string,
  accessToken: string | null | undefined,
  siteUrl: string = process.env.SITE_URL ?? "http://localhost:3000",
): string | null {
  if (!accessToken) return null;
  return `${siteUrl.replace(/\/+$/, "")}/order/${encodeURIComponent(orderNumber)}?t=${encodeURIComponent(accessToken)}`;
}

export function orderTokenMatches(provided: string | undefined | null, stored: string | null): boolean {
  if (!provided || !stored) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}
