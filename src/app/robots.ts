import type { MetadataRoute } from "next";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Per-session (cart/checkout), post-purchase (order), and the owner
      // console — none of these are content a search result should ever land
      // a stranger on.
      disallow: ["/admin", "/api", "/cart", "/checkout", "/order"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
