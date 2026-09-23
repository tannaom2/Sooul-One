"use client";

import Link from "next/link";

/**
 * Storefront error boundary.
 *
 * Exists because product/[slug], gummies/[brand] and order/[orderNumber] all
 * used to swallow a real database error into "not found" or an empty page —
 * which looks identical to a shopper but means something very different: one
 * is "this doesn't exist," the other is "we can't tell right now." Letting
 * the error reach this boundary instead means a transient outage shows as an
 * outage, with a retry, rather than as a product or order that's vanished.
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-5 py-24 text-center">
      <p className="text-h2 font-extrabold">Something didn&apos;t load</p>
      <p className="mt-3 text-ink-soft">
        That&apos;s on us, not your connection — please try again in a moment. If you were checking on an
        order, it hasn&apos;t been affected by this.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button onClick={reset} className="btn btn-solid">
          Try again
        </button>
        <Link href="/" className="btn btn-outline">
          Back to home
        </Link>
      </div>
    </div>
  );
}
