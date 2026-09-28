import type { MetadataRoute } from "next";

/**
 * The web app manifest (/manifest.webmanifest): what a phone uses when the
 * shopper adds the store to their home screen. Icons are made by
 * scripts/brand/make-icons.cjs, in the site's own font and colours.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SooulOne",
    short_name: "SooulOne",
    description: "Healthy snacks from The True Store and daily gummies from Woman Axis, Kids Vault and Man Rituals.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f2ede4",
    theme_color: "#241c15",
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/android-chrome-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
