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

/**
 * Runs before every page request. Four jobs:
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
 * `x-invoke-path` and `x-new-session` are always overwritten here, never
 * trusted from the client, since layouts make decisions based on them.
 */

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|lighthouse/i;

const limiter = new MemoryLimiter();
const MODE = guardMode(process.env.BOT_GUARD, process.env.NODE_ENV === "production");
// QA suites and the demo drive a headless browser on purpose.
const ALLOW_HEADLESS = process.env.BOT_GUARD_ALLOW_HEADLESS === "1";

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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdmin = pathname.startsWith("/admin");
  const isApi = pathname.startsWith("/api");

  const blocked = await guard(request, pathname);
  if (blocked) return blocked;

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
  if (newSessionId) requestHeaders.set("x-new-session", "1");

  if (isAdmin && !pathname.startsWith("/admin/login") && !request.cookies.get("soulone_admin")) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
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
