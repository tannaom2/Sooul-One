import Link from "next/link";

export const metadata = { title: "Page not found" };

/**
 * A wrong or old link (a product taken down, a mistyped URL shared on
 * WhatsApp) lands here, inside the site's own header and footer, with the
 * ways back into the shop rather than a bare "404".
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
      <p className="text-micro font-semibold tracking-wide text-ink-faint uppercase">Page not found</p>
      <h1 className="mt-2 max-w-[20ch] text-h1 font-extrabold">We couldn&rsquo;t find that page.</h1>
      <p className="mt-3 max-w-[52ch] text-lead text-ink-soft">
        The link may be old, or the product may no longer be listed. Everything we sell is a tap away below.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/true-store" className="btn btn-solid">
          Shop The True Store
        </Link>
        <Link href="/gummies" className="btn btn-outline">
          Shop gummies
        </Link>
        <Link href="/stores" className="btn btn-outline">
          Find a store
        </Link>
      </div>
    </div>
  );
}
