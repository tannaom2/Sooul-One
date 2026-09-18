import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge gate for the owner console.
 *
 * Only checks that a session cookie is PRESENT — it deliberately does not
 * verify the JWT here. This runs on the edge runtime, where the crypto needed
 * for verification is awkward, and more importantly a gate that merely
 * looks authoritative is worse than one that is honestly shallow. Real
 * verification (signature, expiry, MFA flag) happens in the admin layout on
 * the server, which is the boundary that actually protects data.
 *
 * This layer exists to bounce anonymous traffic cheaply, not to be the lock.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/admin")) return NextResponse.next();

  // admin/layout.tsx reads this to tell the login page apart from every other
  // admin route, since it can't call usePathname() from a server component.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-invoke-path", pathname);
  const withPathHeader = { request: { headers: requestHeaders } };

  if (pathname.startsWith("/admin/login")) return NextResponse.next(withPathHeader);

  if (!request.cookies.get("soulone_admin")) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next(withPathHeader);
}

export const config = { matcher: ["/admin/:path*"] };
