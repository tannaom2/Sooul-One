import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { BASKET_COUNT_COOKIE } from "@/lib/session-cookie";
import { CartProvider } from "@/components/basket/cart-provider";
import { SERVICE_AREA } from "@/lib/checkout/service-area";
import { DEFAULT_SHIPPING_POLICY } from "@/lib/checkout/quote";
import { formatPriceTag } from "@/lib/money";
import { BasketButton } from "@/components/basket/basket-button";
import { BasketDrawer } from "@/components/basket/basket-drawer";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { getBusinessProfile } from "@/server/business";
import "./globals.css";

/**
 * Fonts are loaded via a stylesheet link rather than `next/font/google`.
 *
 * `next/font` downloads and self-hosts the files at BUILD time, which is
 * lovely until the build runs somewhere without egress to fonts.googleapis.com
 * — a locked-down CI runner, an air-gapped box, or an offline laptop — where
 * it fails the whole build over a typeface. A stylesheet link moves that
 * fetch to the browser, so the build stays portable.
 *
 * The trade is a small flash of fallback text on first paint. The CSS variable
 * stacks in globals.css name real fallbacks so that flash is legible rather
 * than blank. If you would rather have zero layout shift and can guarantee
 * build-time egress, swapping back to `next/font/google` is a contained change
 * to this file.
 */

export const metadata: Metadata = {
  // Required for Next.js to resolve relative canonical/OG URLs to absolute
  // ones. Falls back to localhost in dev; set SITE_URL before going live or
  // every canonical and Open Graph image resolves to the wrong domain.
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "SooulOne — nutrition, honestly labelled",
  description:
    "Healthy namkeen, sweets and snacks from The True Store, and daily gummies from Woman Axis, Kids Vault and Man Rituals. Every label, in full, before you buy.",
};

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-paper/95 backdrop-blur print:hidden">
      {/* Said up front, so shoppers outside the area learn it before they fill a basket. */}
      <p className="bg-ink px-5 py-1.5 text-center text-micro font-semibold text-paper">
        Delivering across {SERVICE_AREA.label} · Free delivery over {formatPriceTag(DEFAULT_SHIPPING_POLICY.freeAbovePaise)}
      </p>
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
        <Link href="/" className="font-display text-lead font-extrabold tracking-tight">
          SooulOne
        </Link>
        <div className="hidden gap-5 text-small font-medium sm:flex">
          <Link href="/true-store" className="hover:underline">
            The True Store
          </Link>
          <Link href="/gummies" className="hover:underline">
            Gummies
          </Link>
          <Link href="/stores" className="hover:underline">
            Find a store
          </Link>
        </div>
        <BasketButton />
      </nav>
    </header>
  );
}

/**
 * Site-wide legal displays: the FSSAI licence, the seller's legal identity,
 * customer care, and the grievance officer the Consumer Protection
 * (E-Commerce) Rules require. All come from Settings → Business details.
 *
 * When the licence is absent the footer says so plainly rather than rendering
 * a placeholder. A fabricated licence number is a considerably worse problem
 * than a visibly missing one, and the gap should be uncomfortable. Other
 * missing details are simply left out; the launch-readiness check lists them.
 */
async function Footer() {
  const business = await getBusinessProfile();
  const licence = business.fssaiLicence;
  const identity = [business.legalName, business.registeredAddress, business.gstin && `GSTIN ${business.gstin}`].filter(Boolean);
  const officer = [business.grievanceOfficerName, business.grievanceOfficerDesignation].filter(Boolean).join(", ");

  return (
    <footer className="mt-24 border-t border-rule bg-shelf print:hidden">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="font-display text-h3 font-extrabold">SooulOne</p>
          <p className="mt-2 max-w-[38ch] text-small text-ink-soft">
            Snacks and supplements with the whole label on the page, not just on the pack.
          </p>
        </div>

        <div className="text-small">
          <p className="mb-2 font-semibold">Shop</p>
          <ul className="grid gap-1.5 text-ink-soft">
            <li>
              <Link href="/true-store" className="hover:text-ink">
                The True Store
              </Link>
            </li>
            <li>
              <Link href="/gummies/woman-axis" className="hover:text-ink">
                Woman Axis
              </Link>
            </li>
            <li>
              <Link href="/gummies/kids-vault" className="hover:text-ink">
                Kids Vault
              </Link>
            </li>
            <li>
              <Link href="/gummies/man-rituals" className="hover:text-ink">
                Man Rituals
              </Link>
            </li>
          </ul>
        </div>

        <div className="text-small">
          <p className="mb-2 font-semibold">Policies</p>
          <ul className="grid gap-1.5 text-ink-soft">
            <li>
              <Link href="/policies/privacy" className="hover:text-ink">
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/policies/terms" className="hover:text-ink">
                Terms
              </Link>
            </li>
            <li>
              <Link href="/policies/refunds" className="hover:text-ink">
                Refunds
              </Link>
            </li>
            <li>
              <Link href="/policies/shipping" className="hover:text-ink">
                Shipping
              </Link>
            </li>
          </ul>
        </div>

        <div className="text-small">
          <p className="mb-2 font-semibold">Help</p>
          <ul className="grid gap-1.5 text-ink-soft">
            {business.customerCarePhone && <li className="tabular">Customer care {business.customerCarePhone}</li>}
            {business.customerCareEmail && <li className="break-all">{business.customerCareEmail}</li>}
          </ul>
          {officer && (
            <div className="mt-3 text-ink-soft">
              <p className="font-semibold text-ink">Grievance officer</p>
              <p>{officer}</p>
              {business.grievanceOfficerEmail && <p className="break-all">{business.grievanceOfficerEmail}</p>}
              {business.grievanceOfficerPhone && <p className="tabular">{business.grievanceOfficerPhone}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-rule">
        <div className="mx-auto grid max-w-6xl gap-2 px-5 py-6 text-micro text-ink-faint">
          {identity.length > 0 && <p>{identity.join(" · ")}</p>}
          {licence ? (
            <p className="tabular">FSSAI licence {licence}</p>
          ) : (
            <p className="text-alert">FSSAI licence number not yet configured. Required before taking orders.</p>
          )}
          <p>
            Supplement statements have not been evaluated as medicines and are not intended to diagnose, treat, cure or
            prevent any disease.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Top of the funnel, recorded once per new visitor. proxy.ts issues the
  // session cookie and sets x-new-session on the very first request, so this
  // only reads — Server Components can't set cookies.
  const requestHeaders = await headers();
  const path = requestHeaders.get("x-invoke-path") ?? "";
  const isAdmin = path.startsWith("/admin");
  if (requestHeaders.get("x-new-session") === "1") {
    const sessionId = await readSessionId();
    if (sessionId) after(() => recordEvent(sessionId, "VISIT", { metadata: { path } }));
  }

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/*
          eslint-disable-next-line @next/next/no-page-custom-font --
          This rule warns that a custom font "will only load for a single page"
          unless it is declared in `pages/_document.js`. That premise is Pages
          Router-specific: this IS the App Router root layout, so the link
          applies to every route, which is exactly what the rule wants. The
          deliberate choice not to use `next/font` here is explained above.
        */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Public+Sans:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        {/* The owner console has its own chrome (admin/layout.tsx); the
            storefront's sticky header used to sit on top of it. */}
        {isAdmin ? (
          <main>{children}</main>
        ) : (
          // The badge count comes from a cookie the basket actions keep current,
          // so showing it costs no database call on every page.
          <CartProvider initialCount={Math.max(0, Number((await cookies()).get(BASKET_COUNT_COOKIE)?.value) || 0)}>
            <Nav />
            <main>{children}</main>
            <Footer />
            <BasketDrawer />
          </CartProvider>
        )}
      </body>
    </html>
  );
}
