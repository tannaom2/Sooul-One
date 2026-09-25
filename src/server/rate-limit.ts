import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";

/**
 * Fixed-window attempt counters in Postgres (RateLimit table). They survive
 * deploys and are shared by every app instance, unlike an in-memory map.
 * Each call is one statement, however many keys it counts.
 */

/**
 * Count one attempt against each key and return every key's count in its
 * current window. A key whose window has passed starts again at 1.
 */
export async function hit(keys: readonly string[], windowSeconds: number): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  const rows = await db.$queryRaw<{ key: string; count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart")
    SELECT k, 1, now() AT TIME ZONE 'UTC' FROM unnest(${keys as string[]}::text[]) AS k
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."windowStart" <= (now() AT TIME ZONE 'UTC') - make_interval(secs => ${windowSeconds})
        THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE
        WHEN "RateLimit"."windowStart" <= (now() AT TIME ZONE 'UTC') - make_interval(secs => ${windowSeconds})
        THEN now() AT TIME ZONE 'UTC' ELSE "RateLimit"."windowStart" END
    RETURNING "key", "count"`;

  // Now and then, after the response, drop counters idle for over a day.
  if (Math.random() < 0.02) {
    after(() =>
      db.rateLimit
        .deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
        .catch(() => undefined),
    );
  }
  return new Map(rows.map((r) => [r.key, Number(r.count)]));
}

/** Count one attempt; true when it's over the limit. */
export async function overLimit(key: string, limit: { max: number; windowSeconds: number }): Promise<boolean> {
  const counts = await hit([key], limit.windowSeconds);
  return (counts.get(key) ?? 0) > limit.max;
}

/** Forget these keys, e.g. an account's failures after a successful sign-in. */
export async function clearHits(keys: readonly string[]): Promise<void> {
  if (keys.length > 0) await db.rateLimit.deleteMany({ where: { key: { in: [...keys] } } });
}
