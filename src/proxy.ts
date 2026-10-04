import { NextResponse, type NextRequest } from "next/server";
import {
  BASKET_COUNT_COOKIE,
  BASKET_COUNT_COOKIE_OPTIONS,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/session-cookie";
import { contentSecurityPolicy, newNonce } from "@/lib/csp";
import { CUSTOMER_COOKIE, CUSTOMER_COOKIE_OPTIONS } from "@/lib/customer-session";
import { PAGE_LIMITS, decide, guardMode, requestKind, suspicious, type Verdict } from "@/lib/bot-guard";
import { MemoryLimiter } from "@/lib/memory-rate-limit";
import { clientIp } from "@/lib/rate-limit-rules";
import { verifyCrawler } from "@/server/crawler-verify";
import { decideHost, normalizeHost } from "@/lib/brand-domains";
import { brandDomainsForProxy } from "@/server/brand-family";
import { NOINDEX, mayIndex, searchIndexingOn } from "@/lib/indexing";
import { ATTRIBUTION_COOKIE, ATTRIBUTION_COOKIE_OPTIONS, decodeAttribution, encodeAttribution, mergeTouch, touchFrom } from "@/lib/attribution";

/**
 * Runs before every page request. Five jobs:
 *
 * -1. Bot guard (src/lib/bot-guard.ts): turn away scripts, headless browsers,
 *    bulk scrapers and fake search engines, and throttle floods, before any
 *    page or API does work. BOT_GUARD=off|monitor|block (block by default in
 *    production; monitor elsewhere, which logs what it would have done).
 *
 * 0. Security: a fresh script nonce and Content-Security-Policy for every
 *    request (src/lib/csp.ts). The policy goes on the request too, which is
 *    where Next.js reads the nonce to stamp its own scripts.
 *
 * 1. Storefront: issue the guest session cookie up front. Server Components
 *    are not allowed to set cookies, so doing it during page render (as the
 *    funnel tracking once did) threw — and the error was swallowed, which is
 *    why "Visited the site" read zero. Here it can be set, and it's also put
 *    on the request so the page rendering right now already sees it. An
 *    existing basket cookie (and its badge count) is re-issued with a fresh
 *    year on every page visit: a sliding expiry, so a returning shopper's
 *    basket is still there.
 *
 * 2. Owner console: bounce requests with no admin cookie at all. This only
 *    checks the cookie is PRESENT — real verification (signature, expiry, MFA,
 *    role) happens server-side in the admin layout and on every page and
 *    action. This layer bounces anonymous traffic cheaply; it isn't the lock.
 *
 * 3. Brand domains (src/lib/brand-domains.ts): a brand's own domain either
 *    redirects to its page on the main site, or is served as the brand's
 *    own site (its home page rewritten to the brand page). Looked up only
 *    when the request isn't for the main site's own host.
 *
 * 4. Attribution (src/lib/attribution.ts): note the campaign or site a
 *    visit came from, in a first-party cookie checkout copies onto the order.
 *
 * 5. Search engines (src/lib/indexing.ts): every page says noindex until
 *    SEARCH_INDEXING=on, and always on any address that isn't the shop's own
 *    domain or a brand's standalone one.
 *
 * `x-invoke-path`, `x-new-session` and `x-brand-host` are always overwritten here, never
 * trusted from the client, since layouts make decisions based on them.
 */

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|lighthouse/i;

const limiter = new MemoryLimiter();
const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";
const MAIN_HOST = normalizeHost(URL.canParse(SITE_URL) ? new URL(SITE_URL).host : "localhost");
const MODE = guardMode(process.env.BOT_GUARD, process.env.NODE_ENV === "production");
// QA suites and the demo drive a headless browser on purpose.
const ALLOW_HEADLESS = process.env.BOT_GUARD_ALLOW_HEADLESS === "1";
const SEARCH_ON = searchIndexingOn(process.env.SEARCH_INDEXING);

function refused(status: 403 | 429, retryAfter?: number): NextResponse {
  return new NextResponse(status === 403 ? "Automated access isn't allowed." : "Too many requests. Slow down and try again shortly.", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) },
  });
}

/** The bot guard's answer for this request: a response to send instead, or null to carry on. */
async function guard(request: NextRequest, pathname: string): Promise<NextResponse | null> {
  if (MODE === "off") return null;
  const req = {
    path: pathname,
    userAgent: request.headers.get("user-agent"),
    acceptLanguage: request.headers.get("accept-language"),
    allowHeadless: ALLOW_HEADLESS,
  };
  const ip = clientIp(request.headers);
  let verdict: Verdict = decide(req);
  if (verdict.action === "allow" && verdict.reason === "exempt") return null;
  let crawler = false;
  if (verdict.action === "verify") {
    // Verified: the crawler allowance. Failed: a fake. Unknown (DNS trouble): an ordinary visitor.
    const check = await verifyCrawler(ip, verdict.crawler);
    crawler = check === "verified";
    verdict = check === "failed" ? { action: "block", reason: `fake ${verdict.crawler} crawler` } : { action: "allow" };
  }

  // Floods: page views, and Server Action posts (add to basket and the like).
  const isAction = request.method === "POST" && request.headers.has("next-action");
  // Page loads and background fetches (link prefetches, in-app navigations) have separate allowances.
  const background = !isAction && requestKind(request.headers, request.nextUrl) === "background";
  const scope = isAction ? "actions" : crawler ? "crawler" : background ? "background" : suspicious(req) ? "suspicious" : "pages";
  const limit = PAGE_LIMITS[scope];
  const over = verdict.action === "allow" && ip !== "local" && limiter.hit(`${scope}:${ip}`, limit.windowSeconds) > limit.max;

  if (verdict.action === "allow" && !over) return null;
  const reason = verdict.action === "block" ? verdict.reason : `over ${scope} limit`;
  // The path and reason only: addresses are personal data and stay out of logs.
  console.warn(`[bot-guard] ${MODE === "block" ? "refused" : "would refuse"} ${request.method} ${pathname}: ${reason}`);
  if (MODE === "monitor") return null;
  return over ? refused(429, limiter.retryAfter(`${scope}:${ip}`, limit.windowSeconds)) : refused(403);
}

/** The attribution cookie's new value after this page visit, or null to leave it as it is. */
async function nextAttribution(request: NextRequest, host: string): Promise<string | null> {
  const referrer = request.headers.get("referer");
  const own = [MAIN_HOST, normalizeHost(host)];
  let touch = touchFrom(request.nextUrl, referrer, own, new Date());
  // A link from one of our brand domains isn't a referral. Looked up only for outside referrers.
  if (touch?.medium === "referral") {
    const brands = (await brandDomainsForProxy()).flatMap((b) => (b.domain ? [b.domain] : []));
    touch = touchFrom(request.nextUrl, referrer, [...own, ...brands], new Date());
  }
  const next = mergeTouch(decodeAttribution(request.cookies.get(ATTRIBUTION_COOKIE)?.value), touch);
  return next ? encodeAttribution(next) : null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdmin = pathname.startsWith("/admin");
  const isApi = pathname.startsWith("/api");

  const blocked = await guard(request, pathname);
  if (blocked) return blocked;

  // A brand's own domain: sent on to the main site, or served as the brand's site.
  let brandHost: string | null = null;
  let rewrite: string | null = null;
  const host = request.headers.get("host") ?? "";
  if (normalizeHost(host) !== MAIN_HOST) {
    const decision = decideHost(host, pathname, request.nextUrl.search, await brandDomainsForProxy(), SITE_URL);
    if (decision.kind === "redirect") return NextResponse.redirect(decision.location, decision.status);
    if (decision.kind === "standalone") {
      brandHost = decision.brand;
      rewrite = decision.rewrite;
    }
  }

  // Bots would otherwise each count as a new "visitor" in the funnel.
  const newSessionId =
    !isAdmin && !isApi && !request.cookies.get(SESSION_COOKIE) && !BOT.test(request.headers.get("user-agent") ?? "")
      ? crypto.randomUUID()
      : null;
  if (newSessionId) request.cookies.set(SESSION_COOKIE, newSessionId);

  const csp = contentSecurityPolicy(newNonce(), { dev: process.env.NODE_ENV === "development" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-invoke-path", pathname);
  requestHeaders.delete("x-new-session");
  requestHeaders.delete("x-brand-host");
  if (brandHost) requestHeaders.set("x-brand-host", brandHost);
  if (newSessionId) requestHeaders.set("x-new-session", "1");

  if (isAdmin && !pathname.startsWith("/admin/login") && !request.cookies.get("soulone_admin")) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const response = rewrite
    ? NextResponse.rewrite(new URL(`${rewrite}${request.nextUrl.search}`, request.url), { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  if (!mayIndex({ on: SEARCH_ON, host, mainHost: MAIN_HOST, standaloneBrand: brandHost !== null })) response.headers.set("X-Robots-Tag", NOINDEX);
  if (newSessionId) response.cookies.set(SESSION_COOKIE, newSessionId, SESSION_COOKIE_OPTIONS);

  // Sliding expiry: page views only. Not the owner console or APIs, and not
  // POSTs: a basket Server Action posts to the page path and rewrites the
  // badge count itself, which a re-issued old count here would contradict.
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (!newSessionId && existing && !isAdmin && !isApi && request.method === "GET") {
    response.cookies.set(SESSION_COOKIE, existing, SESSION_COOKIE_OPTIONS);
    const count = request.cookies.get(BASKET_COUNT_COOKIE)?.value;
    if (count) response.cookies.set(BASKET_COUNT_COOKIE, count, BASKET_COUNT_COOKIE_OPTIONS);
  }
  if (!isAdmin && !isApi && request.method === "GET" && !BOT.test(request.headers.get("user-agent") ?? "") && requestKind(request.headers, request.nextUrl) === "page") {
    const attribution = await nextAttribution(request, host);
    if (attribution) response.cookies.set(ATTRIBUTION_COOKIE, attribution, ATTRIBUTION_COOKIE_OPTIONS);
  }
  // A signed-in shopper's cookie slides with each page visit, like the basket's;
  // the session itself decides whether it's still valid (src/lib/customer-session.ts).
  const signedIn = request.cookies.get(CUSTOMER_COOKIE)?.value;
  if (signedIn && !isAdmin && !isApi && request.method === "GET") {
    response.cookies.set(CUSTOMER_COOKIE, signedIn, CUSTOMER_COOKIE_OPTIONS);
  }
  return response;
}

// Every page, but not static assets or files with an extension.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"] };
