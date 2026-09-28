"use client";

import Link from "next/link";

/**
 * Console error boundary. The error itself was already reported server-side
 * (onRequestError in src/instrumentation.ts); the digest shown here is the
 * id to search for in the server log or Sentry.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-lg py-16">
      <h1 className="text-h2 font-extrabold">This page didn&apos;t load</h1>
      <p className="mt-3 text-ink-soft">
        Nothing was changed. It&apos;s usually a brief database hiccup, so try again. If it keeps happening, the
        reference below points to the exact error in the server log.
      </p>
      {error.digest && (
        <p className="mt-4 text-small text-ink-faint">
          Reference: <code className="tabular select-all">{error.digest}</code>
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <button onClick={reset} className="btn btn-solid">
          Try again
        </button>
        <Link href="/admin" className="btn btn-outline">
          Back to overview
        </Link>
      </div>
    </div>
  );
}
