import { NextResponse, type NextRequest } from "next/server";
import {
  BASKET_COUNT_COOKIE,
  BASKET_COUNT_COOKIE_OPTIONS,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/session-cookie";

/**
 * Runs before every page request. Two jobs:
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdmin = pathname.startsWith("/admin");
  const isApi = pathname.startsWith("/api");

  // Bots would otherwise each count as a new "visitor" in the funnel.
  const newSessionId =
    !isAdmin && !isApi && !request.cookies.get(SESSION_COOKIE) && !BOT.test(request.headers.get("user-agent") ?? "")
      ? crypto.randomUUID()
      : null;
  if (newSessionId) request.cookies.set(SESSION_COOKIE, newSessionId);

  const requestHeaders = new Headers(request.headers);
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
  return response;
}

// Every page, but not static assets or files with an extension.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"] };
