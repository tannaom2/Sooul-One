/**
 * Storefront bot rules: who a request says it is, and what to do about it.
 * Pure, so every rule is unit-tested (tests/bot-guard.test.ts); applied by
 * src/proxy.ts on every storefront request, before any page or API runs.
 *
 * What's blocked (403): scripts and tools that announce themselves (curl,
 * python-requests, Go, Scrapy...), headless browsers, known bulk scrapers,
 * no user agent at all, and anything claiming to be Google or Bing that
 * isn't (checked by reverse DNS in src/server/crawler-verify.ts).
 *
 * What's never blocked: real search engines (verified), link previews
 * (WhatsApp, Facebook, X, LinkedIn, Telegram, Slack), the owner console, and
 * server-to-server paths that authenticate themselves (payment webhooks,
 * cron jobs, the health check).
 *
 * Floods are throttled (429 with Retry-After, never 403, so a search engine
 * that's merely fast backs off instead of dropping pages).
 *
 * Every UA check can be fooled by a determined scraper that copies a browser's
 * user agent; that's what the rate limits, Turnstile on checkout and
 * Cloudflare in front of the site are for. This layer removes the cheap,
 * noisy traffic.
 */

export type BotKind = "browser" | "search" | "preview" | "tool" | "headless" | "scraper" | "empty";

export interface Classified {
  readonly kind: BotKind;
  /** The crawler to verify by reverse DNS, for search engines that support it. */
  readonly crawler?: "google" | "bing" | "apple";
}

const SEARCH: readonly [RegExp, Classified["crawler"]][] = [
  [/googlebot|google-inspectiontool|googleother|adsbot-google|mediapartners-google|storebot-google/i, "google"],
  [/bingbot|adidxbot|bingpreview/i, "bing"],
  [/applebot/i, "apple"],
  // DuckDuckGo publishes an IP list rather than reverse DNS: served like a browser, with browser limits.
  [/duckduckbot|duckassistbot/i, undefined],
];

/** Link previews when someone shares a product: must always work. */
const PREVIEW = /facebookexternalhit|facebookcatalog|whatsapp|twitterbot|linkedinbot|telegrambot|slackbot|discordbot|pinterestbot|skypeuripreview|redditbot|embedly/i;

const TOOL = /\b(curl|wget|python-requests|python-urllib|python-httpx|aiohttp|httpx|go-http-client|java\/|okhttp|node-fetch|axios|undici|libwww-perl|lwp::|scrapy|httpclient|mechanize|guzzle|restsharp|postmanruntime|insomnia|powershell|winhttp)\b/i;

const HEADLESS = /headlesschrome|phantomjs|puppeteer|playwright|selenium|webdriver|electron\/.*headless/i;

/** Bulk crawlers that take a lot and send no shoppers back. */
const SCRAPER = /bytespider|mj12bot|dotbot|petalbot|dataforseobot|blexbot|serpstatbot|megaindex|seekport|zoominfobot|barkrowler|screaming frog|sitesucker|httrack|webcopier|ahrefssiteaudit/i;

export function classify(userAgent: string | null | undefined): Classified {
  const ua = (userAgent ?? "").trim();
  if (!ua) return { kind: "empty" };
  for (const [pattern, crawler] of SEARCH) if (pattern.test(ua)) return { kind: "search", crawler };
  if (PREVIEW.test(ua)) return { kind: "preview" };
  if (HEADLESS.test(ua)) return { kind: "headless" };
  if (TOOL.test(ua)) return { kind: "tool" };
  if (SCRAPER.test(ua)) return { kind: "scraper" };
  return { kind: "browser" };
}

/** Paths that authenticate themselves or must always answer. */
const EXEMPT = [/^\/api\/webhooks\//, /^\/api\/cron\//, /^\/api\/health$/, /^\/robots\.txt$/, /^\/sitemap\.xml$/, /^\/manifest\.webmanifest$/];

export type GuardMode = "off" | "monitor" | "block";

export type Verdict =
  | { readonly action: "allow"; readonly reason?: string }
  | { readonly action: "verify"; readonly crawler: NonNullable<Classified["crawler"]> }
  | { readonly action: "block"; readonly reason: string };

export interface GuardRequest {
  readonly path: string;
  readonly userAgent: string | null;
  readonly acceptLanguage: string | null;
  readonly allowHeadless: boolean;
}

export function decide(req: GuardRequest): Verdict {
  if (req.path.startsWith("/admin") || EXEMPT.some((p) => p.test(req.path))) return { action: "allow", reason: "exempt" };
  const c = classify(req.userAgent);
  switch (c.kind) {
    case "search":
      return c.crawler ? { action: "verify", crawler: c.crawler } : { action: "allow" };
    case "preview":
    case "browser":
      return { action: "allow" };
    case "headless":
      return req.allowHeadless ? { action: "allow", reason: "headless allowed here" } : { action: "block", reason: "headless browser" };
    case "tool":
      return { action: "block", reason: "automation tool" };
    case "scraper":
      return { action: "block", reason: "bulk scraper" };
    case "empty":
      return { action: "block", reason: "no user agent" };
  }
}

/**
 * A browser that doesn't send Accept-Language is almost always a script
 * wearing a browser's user agent: every real browser sends it. Such requests
 * aren't blocked (a privacy tool might strip it) but get the tighter limit.
 */
export function suspicious(req: GuardRequest): boolean {
  // Link previews included: anyone can put "WhatsApp" in a user agent, and real preview fetches are few.
  const kind = classify(req.userAgent).kind;
  return (kind === "browser" || kind === "preview") && !req.acceptLanguage;
}

/**
 * Requests per minute per IP. Generous: Indian mobile carriers put many
 * shoppers behind one address (carrier-grade NAT), so these stop floods and
 * catalogue scraping, never a busy evening.
 */
export const PAGE_LIMITS = {
  pages: { max: 240, windowSeconds: 60 },
  suspicious: { max: 40, windowSeconds: 60 },
  crawler: { max: 600, windowSeconds: 60 },
  /** Background fetches: link prefetches and in-app navigations (requestKind). */
  background: { max: 1200, windowSeconds: 60 },
  /** Server Actions: add to basket, change quantity, apply a box. */
  actions: { max: 90, windowSeconds: 60 },
} as const;

/**
 * Page loads and background fetches are limited separately. Next.js
 * prefetches every link that scrolls into view (the menu, the footer,
 * product cards: 20–30 requests per page) and fetches in-app navigations in
 * the background; counting those as page views made a shopper browsing
 * quickly hit the page limit after a handful of pages.
 *
 * Browsers label every request (Sec-Fetch-Dest): "document" for a page load,
 * "empty" for a fetch. Next.js strips its own router markers (the rsc header,
 * the _rsc query) before the proxy sees them, so this label is what's left.
 * Background fetches get a much larger allowance of their own, so a script
 * can't dodge flood protection by claiming to be one. Clients that send no
 * label at all (scripts, curl) count as page loads.
 */
export function requestKind(headers: { get(name: string): string | null }, url?: URL): "page" | "background" {
  if (url?.searchParams.has("_rsc")) return "background";
  if (headers.get("rsc") || headers.get("next-router-prefetch") || headers.get("next-router-segment-prefetch")) return "background";
  const dest = headers.get("sec-fetch-dest");
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch")) return "background";
  return dest && dest !== "document" && dest !== "iframe" ? "background" : "page";
}

export function guardMode(env: string | undefined, production: boolean): GuardMode {
  if (env === "off" || env === "monitor" || env === "block") return env;
  return production ? "block" : "monitor";
}
