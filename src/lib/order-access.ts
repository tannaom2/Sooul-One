import { randomBytes, timingSafeEqual } from "node:crypto";

/** 128 bits of randomness, URL-safe. */
export function newOrderAccessToken(): string {
  return randomBytes(16).toString("base64url");
}

export function orderTokenMatches(provided: string | undefined | null, stored: string | null): boolean {
  if (!provided || !stored) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}
