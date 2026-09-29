import { describe, expect, it } from "vitest";
import { PAGE_LIMITS, classify, decide, guardMode, requestKind, suspicious, type GuardRequest } from "@/lib/bot-guard";
import { MemoryLimiter } from "@/lib/memory-rate-limit";
import { STEP_UP_TTL_SECONDS, stepUpValid } from "@/lib/step-up-rules";
import { clientEventSchema } from "@/lib/client-events";

/** Storefront bot rules (src/lib/bot-guard.ts), the page-flood limiter and the activity log's step-up pass. */

const CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const req = (r: Partial<GuardRequest>): GuardRequest => ({ path: "/product/masala-makhana", userAgent: CHROME, acceptLanguage: "en-IN", allowHeadless: false, ...r });

describe("who a request says it is", () => {
  it("tells browsers, search engines, link previews, tools, headless browsers and scrapers apart", () => {
    expect(classify(CHROME).kind).toBe("browser");
    expect(classify("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toEqual({ kind: "search", crawler: "google" });
    expect(classify("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toEqual({ kind: "search", crawler: "bing" });
    expect(classify("WhatsApp/2.23.20.0").kind).toBe("preview");
    expect(classify("facebookexternalhit/1.1").kind).toBe("preview");
    expect(classify("curl/8.4.0").kind).toBe("tool");
    expect(classify("python-requests/2.31.0").kind).toBe("tool");
    expect(classify("Go-http-client/1.1").kind).toBe("tool");
    expect(classify("Scrapy/2.11 (+https://scrapy.org)").kind).toBe("tool");
    expect(classify("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36").kind).toBe("headless");
    expect(classify("Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)").kind).toBe("scraper");
    expect(classify("").kind).toBe("empty");
    expect(classify(null).kind).toBe("empty");
  });
});

describe("what the guard does about it", () => {
  it("lets browsers and link previews through, and sends search engines for verification", () => {
    expect(decide(req({}))).toEqual({ action: "allow" });
    expect(decide(req({ userAgent: "WhatsApp/2.23" }))).toEqual({ action: "allow" });
    expect(decide(req({ userAgent: "Googlebot/2.1" }))).toEqual({ action: "verify", crawler: "google" });
  });

  it("blocks tools, scrapers, empty user agents and headless browsers (unless allowed here)", () => {
    expect(decide(req({ userAgent: "curl/8.4.0" }))).toEqual({ action: "block", reason: "automation tool" });
    expect(decide(req({ userAgent: "MJ12bot/v1.4.8" }))).toEqual({ action: "block", reason: "bulk scraper" });
    expect(decide(req({ userAgent: "" }))).toEqual({ action: "block", reason: "no user agent" });
    expect(decide(req({ userAgent: "HeadlessChrome/129" })).action).toBe("block");
    expect(decide(req({ userAgent: "HeadlessChrome/129", allowHeadless: true })).action).toBe("allow");
  });

  it("never touches the owner console or server-to-server paths", () => {
    for (const path of ["/admin", "/admin/orders", "/api/webhooks/razorpay", "/api/cron/boxes", "/api/health", "/robots.txt", "/sitemap.xml"]) {
      expect(decide(req({ path, userAgent: "curl/8.4.0" }))).toEqual({ action: "allow", reason: "exempt" });
    }
    // Public APIs are guarded like pages.
    expect(decide(req({ path: "/api/checkout/quote", userAgent: "curl/8.4.0" })).action).toBe("block");
  });

  it("gives a browser user agent with no Accept-Language the tighter limit", () => {
    expect(suspicious(req({ acceptLanguage: null }))).toBe(true);
    expect(suspicious(req({}))).toBe(false);
    expect(suspicious(req({ userAgent: "Googlebot/2.1", acceptLanguage: null }))).toBe(false);
  });

  it("blocks in production by default and only logs elsewhere, unless set", () => {
    expect(guardMode(undefined, true)).toBe("block");
    expect(guardMode(undefined, false)).toBe("monitor");
    expect(guardMode("off", true)).toBe("off");
    expect(guardMode("nonsense", true)).toBe("block");
  });
});

describe("page loads and background fetches are limited separately", () => {
  const h = (entries: Record<string, string>) => ({ get: (n: string) => entries[n.toLowerCase()] ?? null });
  it("counts a page load as a page, and prefetches or in-app navigations as background", () => {
    expect(requestKind(h({ "sec-fetch-dest": "document" }))).toBe("page");
    expect(requestKind(h({}))).toBe("page"); // curl and scripts send no label
    // What the proxy actually sees for a Next.js prefetch: its own markers already stripped.
    expect(requestKind(h({ "sec-fetch-dest": "empty" }))).toBe("background");
    expect(requestKind(h({}), new URL("http://x/product/a?_rsc=5CB68i"))).toBe("background");
    expect(requestKind(h({ rsc: "1", "next-router-segment-prefetch": "/_tree" }))).toBe("background");
    expect(requestKind(h({ "sec-purpose": "prefetch;prerender", "sec-fetch-dest": "document" }))).toBe("background");
  });

  it("gives background fetches a larger allowance, so claiming to be one doesn't escape the limit", () => {
    expect(PAGE_LIMITS.background.max).toBeGreaterThan(PAGE_LIMITS.pages.max);
    expect(PAGE_LIMITS.background.max).toBeLessThanOrEqual(1200);
  });
});

describe("page-flood limiter", () => {
  it("counts per key within a window and starts again after it", () => {
    let t = 0;
    const limiter = new MemoryLimiter(1000, () => t);
    expect(limiter.hit("a", 60)).toBe(1);
    expect(limiter.hit("a", 60)).toBe(2);
    expect(limiter.hit("b", 60)).toBe(1);
    t = 30_000;
    expect(limiter.retryAfter("a", 60)).toBe(30);
    t = 60_000;
    expect(limiter.hit("a", 60)).toBe(1);
  });

  it("stays bounded under a flood of distinct addresses", () => {
    const limiter = new MemoryLimiter(100, () => 0);
    for (let i = 0; i < 1000; i++) limiter.hit(`ip-${i}`, 60);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });
});

describe("activity log step-up pass", () => {
  const current = { adminUserId: "a1", sessionVersion: 2, ua: "hash" };
  it("lasts ten minutes and is good only for the same admin, session version and browser", () => {
    expect(STEP_UP_TTL_SECONDS).toBe(600);
    expect(stepUpValid({ sub: "a1", ver: 2, scope: "audit", ua: "hash" }, current)).toBe(true);
    expect(stepUpValid({ sub: "a2", ver: 2, scope: "audit", ua: "hash" }, current)).toBe(false);
    expect(stepUpValid({ sub: "a1", ver: 1, scope: "audit", ua: "hash" }, current)).toBe(false); // access was reset
    expect(stepUpValid({ sub: "a1", ver: 2, scope: "audit", ua: "other" }, current)).toBe(false); // copied to another browser
    expect(stepUpValid({ sub: "a1", ver: 2, ua: "hash" }, current)).toBe(false);
  });
});

describe("storefront telemetry", () => {
  it("accepts a closed payment window from the browser, with nothing else in it", () => {
    expect(clientEventSchema.safeParse({ type: "PAYMENT_DISMISSED", method: "UPI" }).success).toBe(true);
    expect(clientEventSchema.safeParse({ type: "PAYMENT_DISMISSED", method: "UPI", phone: "9876543210" }).success).toBe(false);
    expect(clientEventSchema.safeParse({ type: "PINCODE_CHECKED", pincode: "380015" }).success).toBe(false); // server-recorded only
  });
});
