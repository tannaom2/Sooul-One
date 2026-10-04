import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { BASKET_COUNT_COOKIE } from "@/lib/session-cookie";
import { CartProvider } from "@/components/basket/cart-provider";
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
import { TopBar } from "@/components/top-bar";
import { TabBar } from "@/components/tab-bar";
import { SocialLinks } from "@/components/social-links";
import { getOpenRoles, getSiteText, getTopBar } from "@/server/site-content";
import { brandHost, getBrandFamily, siteUrl } from "@/server/brand-family";
import { brandForPath, brandHref } from "@/lib/brand-domains";
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
  // Pages name themselves ("Gummies", a product, an article); the site name is
  // added once, here, so every title reads the same way. The home page uses TITLE.
  title: { default: TITLE, template: "%s — SooulOne" },
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

async function Nav({ showThemeToggle, path }: { showThemeToggle: boolean; path: string }) {
  // Accounts need codes to be sendable (src/lib/otp.ts); until then there's
  // nothing to sign in to, so no link.
  const accounts = codeDelivery(process.env) !== "off";
  // "Make your box" only while a box is live (cached with the catalogue).
  const [boxes, messages, family, host] = await Promise.all([activeBoxes().catch(() => []), getTopBar(), getBrandFamily(), brandHost()]);
  const hasBox = boxes.length > 0;
  const hostBrand = host ? family.find((b) => b.slug === host) : undefined;
  const current = brandForPath(path, family.map((b) => b.slug));
  return (
    <>
      <header className="sticky top-0 z-50 border-b border-rule bg-paper/95 backdrop-blur print:hidden">
        {/* Said up front, so shoppers outside the area learn it before they fill a basket (Settings → Top bar). */}
        <TopBar messages={messages} />
        <nav className="relative mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-5">
          <MobileMenu showAccount={accounts} showBox={hasBox} />
          {hostBrand ? (
            // On a brand's own domain the brand leads, endorsed by SooulOne.
            <Link href="/" className="flex flex-col leading-none">
              <span className="font-display text-lead font-extrabold tracking-tight">{hostBrand.name}</span>
              <span className="mt-0.5 text-micro text-ink-soft">a SooulOne brand</span>
            </Link>
          ) : (
            <Link href="/" className="font-display text-lead font-extrabold tracking-tight">
              SooulOne
            </Link>
          )}
          {/* One line each: at tablet width the labels used to wrap ("The True / Store"). */}
          <div className="hidden gap-5 text-small font-medium whitespace-nowrap sm:flex">
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
            <Link href="/stores" className="hidden hover:underline lg:inline">
              Find a store
            </Link>
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            <SiteSearch from={current ?? host} />
            {showThemeToggle && <ThemeToggle />}
            {accounts && (
              <Link href="/account" className="flex h-11 items-center gap-1.5 px-2 text-small font-medium hover:underline" aria-label="Your account">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
                </svg>
                <span className="hidden lg:inline">Account</span>
              </Link>
            )}
            <BasketButton />
          </div>
        </nav>
      </header>
    </>
  );
}

/** Search every brand at once (/search). A plain form, so it works before any script loads. */
function SiteSearch({ from }: { from: string | null }) {
  return (
    <>
      <form action="/search" role="search" className="hidden md:block">
        <label htmlFor="site-search" className="sr-only">
          Search all SooulOne brands
        </label>
        <input id="site-search" name="q" type="search" placeholder="Search all brands" maxLength={80} className="field h-9 w-44 py-1 text-small lg:w-56" />
        {/* The brand you're browsing comes first in the results. */}
        {from && <input type="hidden" name="from" value={from} />}
      </form>
      <Link href={from ? `/search?from=${from}` : "/search"} className="flex h-11 w-11 items-center justify-center md:hidden" aria-label="Search">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
      </Link>
    </>
  );
}

/**
 * Site-wide legal displays: the FSSAI licence, the seller's legal identity,
 * customer care, and the grievance officer the Consumer Protection
 * (E-Commerce) Rules require. All come from Settings → Business details.
 * The words around them (tagline, hours, response time) are Settings → Site
 * text; the brands and their social links are Settings → Brands.
 *
 * When the licence is absent the footer says so plainly rather than rendering
 * a placeholder. A fabricated licence number is a considerably worse problem
 * than a visibly missing one, and the gap should be uncomfortable. Other
 * missing details are simply left out; the launch-readiness check lists them.
 */
async function Footer() {
  const [business, text, family, host, roles] = await Promise.all([getBusinessProfile(), getSiteText(), getBrandFamily(), brandHost(), getOpenRoles()]);
  const licence = business.fssaiLicence;
  const identity = [business.legalName, business.registeredAddress, business.gstin && `GSTIN ${business.gstin}`, business.cin && `CIN ${business.cin}`].filter(Boolean);
  const officer = [business.grievanceOfficerName, business.grievanceOfficerDesignation].filter(Boolean).join(", ");
  const link = "hover:text-ink";

  return (
    <footer className="mt-24 border-t border-rule bg-shelf print:hidden">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-1">
          <p className="font-display text-h3 font-extrabold">SooulOne</p>
          {text["footer.tagline"] && <p className="mt-2 max-w-[38ch] text-small text-ink-soft">{text["footer.tagline"]}</p>}
          <div className="mt-3 -ml-2">
            <SocialLinks owner="SooulOne" links={business} />
          </div>
        </div>

        <div className="text-small">
          <p className="mb-2 font-semibold">Our brands</p>
          <ul className="grid gap-1.5 text-ink-soft">
            {family.map((b) => {
              const href = brandHref(b.slug, family, host, siteUrl());
              return (
                <li key={b.slug} className="flex items-center gap-1">
                  {href.startsWith("/") ? (
                    <Link href={href} className={link}>
                      {b.name}
                    </Link>
                  ) : (
                    <a href={href} className={link}>
                      {b.name}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="text-small">
          <p className="mb-2 font-semibold">Help</p>
          <ul className="grid gap-1.5 text-ink-soft">
            <li>
              <Link href="/help" className={link}>
                Questions and answers
              </Link>
            </li>
            <li>
              <Link href="/verify" className={link}>
                Check your batch
              </Link>
            </li>
            <li>
              <Link href="/contact" className={link}>
                Contact us
              </Link>
            </li>
            <li>
              <Link href="/learn" className={link}>
                Learn
              </Link>
            </li>
            {roles.length > 0 && (
              <li>
                <Link href="/careers" className={link}>
                  Careers
                </Link>
              </li>
            )}
            <li>
              <Link href="/stores" className={link}>
                Find a store
              </Link>
            </li>
          </ul>
        </div>

        <div className="text-small">
          <p className="mb-2 font-semibold">Policies</p>
          <ul className="grid gap-1.5 text-ink-soft">
            <li>
              <Link href="/policies/privacy" className={link}>
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/policies/terms" className={link}>
                Terms
              </Link>
            </li>
            <li>
              <Link href="/policies/refunds" className={link}>
                Refunds
              </Link>
            </li>
            <li>
              <Link href="/policies/shipping" className={link}>
                Shipping
              </Link>
            </li>
          </ul>
        </div>

        <div className="text-small">
          <p className="mb-2 font-semibold">Talk to us</p>
          <ul className="grid gap-1.5 text-ink-soft">
            {business.customerCarePhone && <li className="tabular">Customer care {business.customerCarePhone}</li>}
            {business.customerCareEmail && (
              <li className="break-all">
                <a href={`mailto:${business.customerCareEmail}`} className={link}>
                  {business.customerCareEmail}
                </a>
              </li>
            )}
            {text["contact.hours"] && <li>{text["contact.hours"]}</li>}
            {text["contact.responseTime"] && <li className="text-ink">{text["contact.responseTime"]}</li>}
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
          {business.mailingAddress && <p>Mailing address: {business.mailingAddress}</p>}
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
            <Nav showThemeToggle={theme.toggleVisible} path={path} />
            <main>{children}</main>
            <Footer />
            {/* Phones and upright tablets: Home, shops, search and basket within thumb reach. */}
            <TabBar />
            <BasketDrawer />
            {/* The Help assistant, unless the owner has switched it off (Settings → Assistants). */}
            {(await getAssistantSettings()).enabled && <StorefrontBot />}
          </CartProvider>
        )}
      </body>
    </html>
  );
}
