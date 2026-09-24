/**
 * Retry for database operations that failed while *connecting*.
 *
 * Neon's free tier suspends an idle database and the first connection after
 * that can take longer than the connect timeout — the request then fails with
 * no query ever sent. Retrying that is always safe. Errors after a query was
 * sent ("connection terminated unexpectedly", resets, server-side errors) are
 * deliberately not retried: a write might already have happened.
 */

const CONNECT_CODES = new Set(["ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "P1001"]);
const CONNECT_MESSAGES = [
  "connection terminated due to connection timeout", // pg: connectionTimeoutMillis hit while connecting
  "timeout exceeded when trying to connect", // pg Pool: no connection within the timeout
  "can't reach database server", // Prisma P1001 wording
];

/** True only for failures that happened before any query reached the database. */
export function isConnectError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const { code, message, cause } = e as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === "string" && CONNECT_CODES.has(code)) return true;
    if (typeof message === "string") {
      const m = message.toLowerCase();
      if (CONNECT_MESSAGES.some((s) => m.includes(s))) return true;
    }
    e = cause;
  }
  return false;
}

export async function withConnectRetry<T>(
  run: () => Promise<T>,
  { delaysMs = [300, 1000], sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= delaysMs.length || !isConnectError(error)) throw error;
      console.warn(`[db] connect failed, retrying (${attempt + 1}/${delaysMs.length})`);
      await sleep(delaysMs[attempt]);
    }
  }
}
