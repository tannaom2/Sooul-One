import { describe, expect, it } from "vitest";
import { absoluteUrl, googleProductFeed, jsonLdScript, productJsonLd, type StructuredProduct } from "@/lib/structured-data";

/** F5: what Google and shopping agents read about a product. */

const P: StructuredProduct = {
  name: "Biotin Glow Gummies",
  sku: "WA-BIO-30",
  description: "Biotin, zinc and vitamin E in a strawberry gummy.",
  brand: "Woman Axis",
  category: "Hair & Skin",
  url: "https://sooulone.in/product/biotin-glow-gummies",
  images: ["https://res.cloudinary.com/x/a.jpg", "https://res.cloudinary.com/x/b.jpg"],
  pricePaise: 54_900,
  inStock: true,
  rating: { avg: 4.5, count: 4 },
};

describe("product JSON-LD", () => {
  it("carries the price shoppers pay, real stock and the seller", () => {
    const ld = productJsonLd(P, "SooulOne") as { offers: Record<string, unknown>; brand: Record<string, unknown> };
    expect(ld.offers).toMatchObject({ price: "549.00", priceCurrency: "INR", availability: "https://schema.org/InStock", url: P.url });
    expect(ld.brand).toEqual({ "@type": "Brand", name: "Woman Axis" });
    expect((productJsonLd({ ...P, inStock: false }, "SooulOne") as { offers: { availability: string } }).offers.availability).toBe("https://schema.org/OutOfStock");
  });

  it("includes a rating only when approved reviews exist", () => {
    expect(productJsonLd(P, "SooulOne")).toHaveProperty("aggregateRating.reviewCount", 4);
    expect(productJsonLd({ ...P, rating: null }, "SooulOne")).not.toHaveProperty("aggregateRating");
  });

  it("can't be broken out of its script element by a product's text", () => {
    const out = jsonLdScript(productJsonLd({ ...P, name: "</script><script>alert(1)</script>" }, "SooulOne"));
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });

  it("makes photo paths absolute", () => {
    expect(absoluteUrl("/demo-assets/a.svg", "https://sooulone.in/")).toBe("https://sooulone.in/demo-assets/a.svg");
    expect(absoluteUrl("https://res.cloudinary.com/x.jpg", "https://sooulone.in")).toBe("https://res.cloudinary.com/x.jpg");
  });
});

describe("Google Merchant feed", () => {
  it("lists each product with Merchant Center's required fields", () => {
    const feed = googleProductFeed([P], { title: "SooulOne", siteUrl: "https://sooulone.in" });
    expect(feed).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    for (const tag of ["<g:id>WA-BIO-30</g:id>", "<g:price>549.00 INR</g:price>", "<g:availability>in_stock</g:availability>", "<g:condition>new</g:condition>", "<g:brand>Woman Axis</g:brand>", "<g:identifier_exists>no</g:identifier_exists>", "<g:additional_image_link>https://res.cloudinary.com/x/b.jpg</g:additional_image_link>"]) {
      expect(feed).toContain(tag);
    }
  });

  it("leaves out products without a photo, and escapes text", () => {
    const feed = googleProductFeed([{ ...P, images: [] }, { ...P, sku: "TS-1", name: "Chana & Jor <Garam>", images: ["https://x/y.jpg"] }], { title: "SooulOne", siteUrl: "https://sooulone.in" });
    expect(feed).not.toContain("WA-BIO-30");
    expect(feed).toContain("<g:title>Chana &amp; Jor &lt;Garam&gt;</g:title>");
  });
});
