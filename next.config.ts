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
  {
    // Razorpay's hosted checkout needs script/frame access; Cloudinary serves
    // images. Nothing else is permitted a network origin.
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://res.cloudinary.com",
      "frame-src https://api.razorpay.com https://checkout.razorpay.com",
      "connect-src 'self' https://api.razorpay.com",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
