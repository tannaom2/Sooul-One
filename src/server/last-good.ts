import "server-only";
import { reportError } from "@/lib/observability";

/**
 * Settings reads that must not fail open (launch defect D4).
 *
 * The owner's settings are cached with unstable_cache. A loader that caught a
 * database error and returned defaults had those defaults cached for up to
 * an hour: a paused store reopened, COD came back on, an invoice lost its
 * GSTIN. So the cached loaders now throw on error (unstable_cache never stores
 * a thrown error), and this wrapper answers from the last value it read
 * successfully on this server. With no good value yet, it returns the
 * caller's safe fallback, or rethrows when there's no safe answer.
 */
export function withLastGood<A extends unknown[], T>(
  name: string,
  load: (...args: A) => Promise<T>,
  fallback: ((...args: A) => T) | "throw",
): (...args: A) => Promise<T> {
  const last = new Map<string, T>();
  return async (...args: A) => {
    const key = JSON.stringify(args);
    try {
      const value = await load(...args);
      last.set(key, value);
      return value;
    } catch (error) {
      reportError(name, error);
      if (last.has(key)) return last.get(key)!;
      if (fallback === "throw") throw error;
      return fallback(...args);
    }
  };
}
