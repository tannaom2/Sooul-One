import type { NextConfig } from "next";

/**
 * Security headers are set here rather than per-route so a new route cannot
 * ship without them (build prompt Section 8.1, OWASP baseline).
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  // Content-Security-Policy is set per request in src/proxy.ts, because it
  // carries a fresh script nonce each time (src/lib/csp.ts).
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Cloudinary resizes and re-encodes (AVIF/WebP) at the edge, instead of our
  // server downloading originals to resize them. See src/lib/cloudinary-loader.ts.
  images: {
    loader: "custom",
    loaderFile: "./src/lib/cloudinary-loader.ts",
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },
  async headers() {
    // Files in public/ default to max-age=0 (checked on every visit). Next's own
    // hashed JS and CSS are already immutable for a year; pages and API routes
    // keep the headers Next gives them (no-store when dynamic).
    const cache = (value: string) => [{ key: "Cache-Control", value }];
    const DAY = "public, max-age=86400, stale-while-revalidate=604800";
    return [
      { source: "/:path*", headers: securityHeaders },
      // Versioned in the file name (-v1): a new version is a new URL.
      { source: "/fonts/:file*", headers: cache("public, max-age=31536000, immutable") },
      // Fixed names, so a day, then served while a fresh copy is fetched.
      { source: "/:icon(favicon.ico|favicon-16x16.png|favicon-32x32.png|apple-touch-icon.png|og-default.png)", headers: cache(DAY) },
      { source: "/:icon(android-chrome-.*\\.png)", headers: cache(DAY) },
      { source: "/demo-assets/:file*", headers: cache(DAY) },
      // Belt and braces with robots.txt: the console and accounts never appear in search.
      { source: "/:area(admin|account)/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/:area(admin|account)", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
