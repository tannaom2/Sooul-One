import { timingSafeEqual } from "node:crypto";

/**
 * Whether a scheduled-job request carries CRON_SECRET. Header only
 * (`Authorization: Bearer …` or `x-cron-secret`): a secret in the query
 * string ends up in access logs. Compared in constant time.
 */
export function cronAuthorized(headers: Headers, secret: string | undefined): boolean {
  if (!secret) return false;
  const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = bearer ?? headers.get("x-cron-secret");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
