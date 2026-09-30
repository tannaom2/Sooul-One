import { describe, expect, it } from "vitest";
import { brandForPath, brandHref, brandPath, canonicalUrl, decideHost, normalizeHost, parseDomain, type BrandDomain } from "@/lib/brand-domains";

/** The brand family's web addresses (src/lib/brand-domains.ts). */

const SITE = "https://sooulone.in";
const BRANDS: BrandDomain[] = [
  { slug: "the-true-store", domain: "thetruestore.in", domainMode: "REDIRECT" },
  { slug: "woman-axis", domain: "womanaxis.in", domainMode: "STANDALONE" },
  { slug: "kids-vault", domain: "kidsvault.in", domainMode: "OFF" },
  { slug: "man-rituals", domain: null, domainMode: "OFF" },
];

describe("addresses", () => {
  it("knows where each brand's page is on the main site", () => {
    expect(brandPath("the-true-store")).toBe("/true-store");
    expect(brandPath("woman-axis")).toBe("/gummies/woman-axis");
    expect(brandForPath("/gummies/kids-vault", BRANDS.map((b) => b.slug))).toBe("kids-vault");
    expect(brandForPath("/product/x", BRANDS.map((b) => b.slug))).toBeNull();
  });

  it("cleans up hosts and typed domains", () => {
    expect(normalizeHost("WWW.WomanAxis.in:443")).toBe("womanaxis.in");
    expect(parseDomain("https://www.WomanAxis.in/shop")).toBe("womanaxis.in");
    for (const bad of ["", "womanaxis", "http://", "a b.in", "-x.in"]) expect(parseDomain(bad)).toBeNull();
  });
});

describe("what a request on each host does", () => {
  it("serves the main site, localhost and unknown hosts as they are", () => {
    expect(decideHost("sooulone.in", "/", "", BRANDS, SITE)).toEqual({ kind: "main" });
    expect(decideHost("www.sooulone.in", "/true-store", "", BRANDS, SITE)).toEqual({ kind: "main" });
    expect(decideHost("localhost:3000", "/", "", BRANDS, SITE)).toEqual({ kind: "main" });
    expect(decideHost("soulone.onrender.com", "/", "", BRANDS, SITE)).toEqual({ kind: "main" });
  });

  it("sends a redirect-mode domain to the brand's page, keeping deep links", () => {
    expect(decideHost("thetruestore.in", "/", "", BRANDS, SITE)).toEqual({ kind: "redirect", status: 301, location: "https://sooulone.in/true-store" });
    expect(decideHost("www.thetruestore.in", "/product/masala-makhana", "?ref=ig", BRANDS, SITE)).toEqual({
      kind: "redirect",
      status: 301,
      location: "https://sooulone.in/product/masala-makhana?ref=ig",
    });
  });

  it("serves a standalone domain as the brand's site, with the brand page as its home", () => {
    expect(decideHost("womanaxis.in", "/", "", BRANDS, SITE)).toEqual({ kind: "standalone", brand: "woman-axis", rewrite: "/gummies/woman-axis" });
    expect(decideHost("womanaxis.in", "/product/biotin-gummies", "", BRANDS, SITE)).toEqual({ kind: "standalone", brand: "woman-axis", rewrite: null });
    // The same page under its main-site path goes to the one home address.
    expect(decideHost("womanaxis.in", "/gummies/woman-axis", "?concern=hair", BRANDS, SITE)).toEqual({ kind: "redirect", status: 302, location: "https://womanaxis.in/?concern=hair" });
  });

  it("keeps the owner console on the main site", () => {
    expect(decideHost("womanaxis.in", "/admin/orders", "", BRANDS, SITE)).toEqual({ kind: "redirect", status: 302, location: "https://sooulone.in/admin/orders" });
  });

  it("ignores a domain that's switched off", () => {
    expect(decideHost("kidsvault.in", "/", "", BRANDS, SITE)).toEqual({ kind: "main" });
  });
});

describe("one indexed address per page", () => {
  it("names the brand domain for a standalone brand's pages, the main site otherwise", () => {
    expect(canonicalUrl("/gummies/woman-axis", "woman-axis", BRANDS, SITE)).toBe("https://womanaxis.in/");
    expect(canonicalUrl("/product/biotin-gummies", "woman-axis", BRANDS, SITE)).toBe("https://womanaxis.in/product/biotin-gummies");
    expect(canonicalUrl("/true-store", "the-true-store", BRANDS, SITE)).toBe("https://sooulone.in/true-store");
    expect(canonicalUrl("/help", null, BRANDS, SITE)).toBe("https://sooulone.in/help");
    expect(canonicalUrl("/", null, BRANDS, SITE)).toBe("https://sooulone.in");
  });
});

describe("links between sister brands", () => {
  it("sends a standalone brand's link to its domain, others to the main site", () => {
    expect(brandHref("woman-axis", BRANDS, null, SITE)).toBe("https://womanaxis.in/");
    expect(brandHref("kids-vault", BRANDS, null, SITE)).toBe("/gummies/kids-vault");
    // From womanaxis.in, Kids Vault is on the main site: a full link.
    expect(brandHref("kids-vault", BRANDS, "woman-axis", SITE)).toBe("https://sooulone.in/gummies/kids-vault");
    expect(brandHref("woman-axis", BRANDS, "woman-axis", SITE)).toBe("/");
  });
});
