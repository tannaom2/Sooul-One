import type { Metadata, Viewport } from "next";
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
import { MobileMenu } from "@/components/mobile-menu";
import { codeDelivery } from "@/lib/otp";
import { activeBoxes } from "@/server/boxes";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { getBusinessProfile } from "@/server/business";
import { getThemeSettings } from "@/server/store-settings";
import { getAssistantSettings } from "@/server/assistant-settings";
import { StorefrontBot } from "@/components/storefront-bot";
import { CONSOLE_THEME_SETTINGS, CONSOLE_THEME_STORAGE_KEY, THEME_STORAGE_KEY, themeBootScript } from "@/lib/theme";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

/**
 * Fonts are files in public/fonts with @font-face rules in globals.css, not
 * `next/font/google` (which fetches from Google at BUILD time and fails the
 * build without egress) and not a Google Fonts stylesheet (a third-party,
 * render-blocking request on every first visit). The two Latin files are
 * preloaded below so text paints in the brand fonts sooner; the Latin
 * Extended ones (with the rupee sign) load when a page uses them.
 */
const PRELOADED_FONTS = ["/fonts/public-sans-latin-v1.woff2", "/fonts/bricolage-grotesque-latin-v1.woff2"];

const TITLE = "SooulOne — nutrition, honestly labelled";
const DESCRIPTION =
  "Healthy namkeen, sweets and snacks from The True Store, and daily gummies from Woman Axis, Kids Vault and Man Rituals. Every label, in full, before you buy.";

export const metadata: Metadata = {
  // Required for Next.js to resolve relative canonical/OG URLs to absolute
  // ones. Falls back to localhost in dev; set SITE_URL before going live or
  // every canonical and Open Graph image resolves to the wrong domain.
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "SooulOne",
  // Made by scripts/brand/make-icons.cjs. /manifest.webmanifest comes from app/manifest.ts.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  // What WhatsApp, Facebook and X show when a page is shared. Product pages set their own.
  openGraph: {
    type: "website",
    siteName: "SooulOne",
    locale: "en_IN",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og-default.png", width: 1200, height: 630, alt: "SooulOne" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-default.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The browser bar on phones, matching the header's top strip.
  themeColor: "#241c15",
};

async function Nav({ showThemeToggle }: { showThemeToggle: boolean }) {
  // Accounts need codes to be sendable (src/lib/otp.ts); until then there's
  // nothing to sign in to, so no link.
  const accounts = codeDelivery(process.env) !== "off";
  // "Make your box" only while a box is live (cached with the catalogue).
  const hasBox = (await activeBoxes().catch(() => [])).length > 0;
  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-paper/95 backdrop-blur print:hidden">
      {/* Said up front, so shoppers outside the area learn it before they fill a basket. */}
      <p className="bg-inverse px-5 py-1.5 text-center text-micro font-semibold text-on-inverse">
        Delivering across {SERVICE_AREA.label} · Free delivery over {formatPriceTag(DEFAULT_SHIPPING_POLICY.freeAbovePaise)}
      </p>
      <nav className="relative mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
        <MobileMenu showAccount={accounts} showBox={hasBox} />
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
          {hasBox && (
            <Link href="/box" className="font-semibold text-veg hover:underline">
              Make your box
            </Link>
          )}
          <Link href="/stores" className="hover:underline">
            Find a store
          </Link>
        </div>
        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          {showThemeToggle && <ThemeToggle />}
          {accounts && (
            <Link href="/account" className="flex h-11 items-center gap-1.5 px-2 text-small font-medium hover:underline" aria-label="Your account">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
              </svg>
              <span className="hidden sm:inline">Account</span>
            </Link>
          )}
          <BasketButton />
        </div>
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

  // Day/Night (src/lib/theme.ts). Forced: set here, in the HTML. A choice:
  // set by the inline script before the first paint, carrying this request's
  // CSP nonce (src/proxy.ts). The owner console has its own switch and saved
  // choice; the storefront setting never forces it.
  const theme = isAdmin ? CONSOLE_THEME_SETTINGS : await getThemeSettings();
  const themeKey = isAdmin ? CONSOLE_THEME_STORAGE_KEY : THEME_STORAGE_KEY;
  const forced = !theme.toggleVisible ? theme.forcedTheme : undefined;
  const nonce = /'nonce-([^']+)'/.exec(requestHeaders.get("content-security-policy") ?? "")?.[1];

  return (
    // The boot script sets data-theme before React hydrates, hence the warning suppression.
    <html lang="en" data-theme={forced} style={forced ? { colorScheme: forced } : undefined} suppressHydrationWarning>
      <head>
        {theme.toggleVisible && <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeBootScript(theme, themeKey) }} />}
        {PRELOADED_FONTS.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
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
            <Nav showThemeToggle={theme.toggleVisible} />
            <main>{children}</main>
            <Footer />
            <BasketDrawer />
            {/* The Help assistant, unless the owner has switched it off (Settings → Assistants). */}
            {(await getAssistantSettings()).enabled && <StorefrontBot />}
          </CartProvider>
        )}
      </body>
    </html>
  );
}
