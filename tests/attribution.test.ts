import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_COOKIE,
  attributionFromCookieHeader,
  decodeAttribution,
  describeTouch,
  encodeAttribution,
  mergeTouch,
  readAttribution,
  touchFrom,
  type Touch,
} from "@/lib/attribution";

/** Benchmark gap F6: where each order came from, recorded by us (src/lib/attribution.ts). */

const NOW = new Date("2026-10-04T10:00:00Z");
const OWN = ["sooulone.com", "localhost"];
const at = (path: string, referrer: string | null = null) => touchFrom(new URL(`https://sooulone.com${path}`), referrer, OWN, NOW);

describe("reading a visit", () => {
  it("takes UTM tags first, source and medium in lower case", () => {
    expect(at("/product/biotin?utm_source=Instagram&utm_medium=Paid_Social&utm_campaign=Diwali Glow&utm_content=reel-2", "https://l.instagram.com/")).toEqual({
      source: "instagram",
      medium: "paid_social",
      campaign: "Diwali Glow",
      content: "reel-2",
      landing: "/product/biotin",
      at: NOW.toISOString(),
    });
  });

  it("names the ad network from a click id when there are no tags, and keeps the id", () => {
    expect(at("/?gclid=Cj0KCQ-abc")).toMatchObject({ source: "google", medium: "cpc", clickKind: "gclid", clickId: "Cj0KCQ-abc" });
    expect(at("/?fbclid=IwAR1")).toMatchObject({ source: "facebook", medium: "social", clickKind: "fbclid" });
    expect(at("/?utm_source=google&utm_medium=cpc&gclid=x")).toMatchObject({ source: "google", medium: "cpc", clickKind: "gclid" });
  });

  it("sorts outside sites into search, social and referral", () => {
    expect(at("/", "https://www.google.co.in/")).toMatchObject({ source: "google", medium: "organic" });
    expect(at("/", "https://duckduckgo.com/")).toMatchObject({ source: "duckduckgo", medium: "organic" });
    expect(at("/", "https://lm.facebook.com/l.php")).toMatchObject({ source: "facebook", medium: "social" });
    expect(at("/", "https://t.co/abc")).toMatchObject({ source: "x", medium: "social" });
    expect(at("/learn/x", "https://www.healthblog.in/post?id=9")).toMatchObject({ source: "healthblog.in", medium: "referral", landing: "/learn/x" });
  });

  it("ignores clicks within our own sites, and calls no referrer direct", () => {
    expect(at("/cart", "https://sooulone.com/product/x")).toBeNull();
    expect(at("/cart", "https://www.sooulone.com/")).toBeNull();
    expect(at("/")).toMatchObject({ source: "(direct)", medium: "(none)" });
  });

  it("keeps the landing path but never its query, and bounds every value", () => {
    const t = at(`/checkout?email=a@b.in&utm_source=${"x".repeat(500)}`)!;
    expect(t.landing).toBe("/checkout");
    expect(t.source).toHaveLength(100);
    expect(JSON.stringify(t)).not.toContain("a@b.in");
  });
});

describe("first and latest visit", () => {
  const direct = at("/")!;
  const ad = at("/?utm_source=google&utm_medium=cpc&utm_campaign=launch")!;
  const blog = at("/", "https://healthblog.in/")!;

  it("starts the record on the first visit, direct or not", () => {
    expect(mergeTouch(null, direct)).toEqual({ first: direct, last: direct });
  });

  it("lets any non-direct visit replace the latest, but keeps the first", () => {
    expect(mergeTouch({ first: direct, last: direct }, ad)).toEqual({ first: direct, last: ad });
    expect(mergeTouch({ first: direct, last: ad }, blog)).toEqual({ first: direct, last: blog });
  });

  it("never lets a direct visit or an internal click replace a campaign (nothing to rewrite)", () => {
    expect(mergeTouch({ first: ad, last: ad }, direct)).toBeNull();
    expect(mergeTouch({ first: ad, last: ad }, null)).toBeNull();
  });
});

describe("the cookie", () => {
  const ad = at("/?utm_source=google&utm_medium=cpc&utm_campaign=दिवाली")!;

  it("round-trips, unicode included", () => {
    expect(decodeAttribution(encodeAttribution({ first: ad, last: ad }))).toEqual({ first: ad, last: ad });
  });

  it("is read from a Cookie header", () => {
    const header = `soulone_cart=abc; ${ATTRIBUTION_COOKIE}=${encodeAttribution({ first: ad, last: ad })}; other=1`;
    expect(attributionFromCookieHeader(header)?.last.campaign).toBe("दिवाली");
    expect(attributionFromCookieHeader("soulone_cart=abc")).toBeNull();
    expect(attributionFromCookieHeader(null)).toBeNull();
  });

  it("refuses anything edited out of shape: it's the shopper's cookie", () => {
    expect(decodeAttribution("not-base64!!")).toBeNull();
    expect(decodeAttribution(encodeAttribution({ first: ad } as never))).toBeNull();
    expect(readAttribution({ first: { ...ad, source: "" }, last: ad })).toBeNull();
    expect(readAttribution({ first: { ...ad, at: "yesterday" }, last: ad })).toBeNull();
    expect(readAttribution({ first: ad, last: { ...ad, extra: "<script>" } })).toEqual({ first: ad, last: ad });
    expect(decodeAttribution("a".repeat(4000))).toBeNull();
  });
});

it("describes a visit for the console", () => {
  expect(describeTouch(at("/?utm_source=google&utm_medium=cpc&utm_campaign=launch") as Touch)).toBe("google / cpc · launch");
  expect(describeTouch(at("/") as Touch)).toMatch(/^Direct/);
});
