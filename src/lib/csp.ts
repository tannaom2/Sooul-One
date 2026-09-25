/**
 * Content-Security-Policy, built per request with a fresh nonce (audit M6).
 *
 * Scripts: only those carrying this request's nonce run. Next.js adds it to
 * its own scripts automatically (it reads the nonce back from the request's
 * CSP header). 'strict-dynamic' lets those scripts load others, which is how
 * checkout loads Razorpay's script. No 'unsafe-inline', so an injected
 * <script> or onclick= does nothing. The host list stays as a fallback for
 * browsers that predate 'strict-dynamic'.
 *
 * Styles keep 'unsafe-inline': React style={{...}} props are style
 * attributes, which a nonce can't cover, and injected CSS can't run code.
 *
 * Development adds 'unsafe-eval' (React's dev-only error overlay needs it;
 * production never uses eval). No upgrade-insecure-requests: HSTS already
 * forces https on the live site, every source here is https or same-origin,
 * and the directive breaks a production build served on plain-http localhost,
 * which is how CI runs the end-to-end test.
 */
export function contentSecurityPolicy(nonce: string, { dev }: { dev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://checkout.razorpay.com${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://res.cloudinary.com",
    "frame-src https://api.razorpay.com https://checkout.razorpay.com",
    "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join("; ");
}

/** 128 random bits, base64. Unguessable and different on every request. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
