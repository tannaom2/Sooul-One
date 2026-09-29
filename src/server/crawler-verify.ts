import { isIP } from "node:net";
import { reverse, lookup } from "node:dns/promises";

/**
 * Is this really Googlebot (or Bingbot, Applebot)? Scrapers often wear a
 * search engine's user agent, knowing sites let search engines through. The
 * check the search engines themselves publish: reverse DNS on the address
 * must give one of their crawler hostnames, and that hostname must resolve
 * back to the same address.
 *
 * Three answers:
 * - "verified": treated as the crawler (higher page allowance).
 * - "failed": no reverse record, or not theirs; refused as a fake.
 * - "unknown": DNS timed out or errored; served like any browser, with
 *   ordinary limits. Never refused (turning Google away during a DNS blip
 *   costs rankings), never given the crawler allowance (a scraper that makes
 *   its own reverse zone time out mustn't gain from it).
 *
 * Answers are cached per address (a day when known, five minutes when not),
 * the cache is capped, and lookups in flight are capped too, so a flood of
 * fresh addresses can't turn this into a DNS amplifier.
 */

export type CrawlerCheck = "verified" | "failed" | "unknown";

// Crawler hostnames only: googleusercontent.com is every Google Cloud VM, not Googlebot.
const DOMAINS: Record<"google" | "bing" | "apple", readonly string[]> = {
  google: [".googlebot.com", ".google.com"],
  bing: [".search.msn.com"],
  apple: [".applebot.apple.com"],
};

const DAY = 24 * 60 * 60 * 1000;
const UNKNOWN_TTL = 5 * 60 * 1000;
const MAX_CACHE = 10_000;
const MAX_IN_FLIGHT = 20;
const cache = new Map<string, { result: CrawlerCheck; at: number }>();
let inFlight = 0;

function remember(key: string, result: CrawlerCheck) {
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, { result, at: Date.now() });
}

export async function verifyCrawler(ip: string, crawler: keyof typeof DOMAINS): Promise<CrawlerCheck> {
  // Locally there's no real client address, so nothing to verify against.
  if (!ip || ip === "local") return "unknown";
  // A header can say anything: only a real address is looked up.
  if (!isIP(ip)) return "failed";
  const key = `${crawler}|${ip}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.result === "unknown" ? UNKNOWN_TTL : DAY)) return hit.result;
  if (inFlight >= MAX_IN_FLIGHT) return "unknown";
  inFlight += 1;
  try {
    const hosts = await withTimeout(reverse(ip), 1500);
    const host = hosts.find((h) => DOMAINS[crawler].some((d) => h.toLowerCase().endsWith(d)));
    let result: CrawlerCheck = "failed";
    if (host) {
      const back = await withTimeout(lookup(host, { all: true }), 1500);
      if (back.some((a) => a.address === ip)) result = "verified";
    }
    remember(key, result);
    return result;
  } catch (error) {
    // No reverse record at all is a definite answer: search engines always have one.
    const code = (error as { code?: string }).code;
    const result: CrawlerCheck = code === "ENOTFOUND" || code === "ENODATA" ? "failed" : "unknown";
    remember(key, result);
    return result;
  } finally {
    inFlight -= 1;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("dns timeout")), ms))]);
}
