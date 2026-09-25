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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
