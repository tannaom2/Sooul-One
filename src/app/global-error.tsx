"use client";

/**
 * Last-resort boundary for errors in the root layout itself, where
 * src/app/error.tsx can't help because the layout (and its styles) is what
 * failed. Must render its own <html> and <body>, so styling is inline.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fbf8f3", color: "#1d1a16" }}>
        <main style={{ maxWidth: "32rem", margin: "0 auto", padding: "6rem 1rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.75rem" }}>Something didn&apos;t load</h1>
          <p style={{ color: "#5c554c" }}>That&apos;s on us. Please try again in a moment.</p>
          <button
            onClick={reset}
            style={{ marginTop: "1.5rem", padding: "0.75rem 1.5rem", font: "inherit", cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
