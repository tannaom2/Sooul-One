/**
 * In-memory fixed-window counters, for limits checked on every page request
 * (src/proxy.ts). The database-backed limiter (src/server/rate-limit.ts)
 * costs a round trip, which is right for sign-in and checkout but too slow
 * to run in front of every page.
 *
 * Per app instance: with several instances each counts separately, so the
 * effective limit is the limit times the instance count. That's acceptable
 * for flood protection; Cloudflare in front covers distributed floods.
 */

export class MemoryLimiter {
  private readonly counts = new Map<string, { count: number; windowStart: number }>();
  private lastPrune = 0;

  constructor(
    private readonly maxKeys = 50_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Count one hit; returns the count in the key's current window. */
  hit(key: string, windowSeconds: number): number {
    const t = this.now();
    this.prune(t, windowSeconds);
    const entry = this.counts.get(key);
    if (!entry || t - entry.windowStart >= windowSeconds * 1000) {
      this.counts.set(key, { count: 1, windowStart: t });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  /** Seconds until this key's window resets. */
  retryAfter(key: string, windowSeconds: number): number {
    const entry = this.counts.get(key);
    if (!entry) return 0;
    return Math.max(1, Math.ceil((entry.windowStart + windowSeconds * 1000 - this.now()) / 1000));
  }

  get size(): number {
    return this.counts.size;
  }

  private prune(t: number, windowSeconds: number) {
    if (t - this.lastPrune < 30_000 && this.counts.size < this.maxKeys) return;
    this.lastPrune = t;
    for (const [key, entry] of this.counts) if (t - entry.windowStart >= windowSeconds * 1000 * 2) this.counts.delete(key);
    // Still full (a flood of distinct addresses): drop the oldest half.
    if (this.counts.size >= this.maxKeys) {
      const keys = [...this.counts.keys()];
      for (const key of keys.slice(0, Math.floor(keys.length / 2))) this.counts.delete(key);
    }
  }
}
