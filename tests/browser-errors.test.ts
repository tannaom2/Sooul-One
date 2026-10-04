import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { DENY_URLS, IGNORE_ERRORS, MAX_PER_PAGE, createGate, envelopeTarget, errorKey, scrubBreadcrumb, scrubEvent, scrubText, withoutQuery } from "@/lib/browser-errors";

/** F8, errors from shoppers' browsers: privacy, noise, volume and the forwarding route. */

const h = vi.hoisted(() => ({ limited: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/rate-limit", () => ({ limitPublic: vi.fn(async () => (h.limited ? new Response(null, { status: 429 }) : null)) }));

const DSN = "https://abc123@o42.ingest.us.sentry.io/4507";
const header = (dsn: string) => `${JSON.stringify({ event_id: "e1", dsn })}\n{"type":"event"}\n{"message":"x"}`;

describe("what leaves the browser", () => {
  it("strips query strings, which carry the private order key and searches", () => {
    expect(withoutQuery("https://sooulone.in/order/SO-AB12CD-EF?t=secret#top")).toBe("https://sooulone.in/order/SO-AB12CD-EF");
    expect(scrubText("Failed loading /order/SO-1?t=secret and https://sooulone.in/search?q=biotin now")).toBe(
      "Failed loading /order/SO-1 and https://sooulone.in/search now",
    );
  });

  it("drops the person, cookies and headers but the browser's name", () => {
    const event = scrubEvent({
      type: undefined,
      user: { id: "u1", ip_address: "1.2.3.4" },
      message: "see /order/SO-1?t=k",
      request: { url: "https://sooulone.in/checkout?coupon=X", cookies: { s: "1" }, headers: { "User-Agent": "Safari", Referer: "https://sooulone.in/?q=x" }, query_string: "coupon=X" },
      exception: { values: [{ type: "TypeError", value: "bad /search?q=me", stacktrace: { frames: [{ abs_path: "https://sooulone.in/_next/a.js?v=1" }] } }] },
      breadcrumbs: [
        { category: "console", message: "phone 98765 43210" },
        { category: "navigation", data: { from: "/order/SO-1?t=k", to: "/" } },
        { category: "ui.click", message: "button.btn-solid" },
      ],
    } as ErrorEvent);
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ url: "https://sooulone.in/checkout", headers: { "User-Agent": "Safari" } });
    expect(event.message).toBe("see /order/SO-1");
    expect(event.exception?.values?.[0].value).toBe("bad /search");
    expect(event.exception?.values?.[0].stacktrace?.frames?.[0].abs_path).toBe("https://sooulone.in/_next/a.js");
    expect(event.breadcrumbs).toEqual([{ category: "navigation", data: { from: "/order/SO-1", to: "/" } }, { category: "ui.click", message: "button.btn-solid" }]);
  });

  it("never keeps console lines or typing", () => {
    expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
    expect(scrubBreadcrumb({ category: "ui.input", message: "input#phone" })).toBeNull();
    expect(scrubBreadcrumb({ category: "fetch", data: { url: "/api/pincode?pin=380054", status_code: 500 } })).toEqual({ category: "fetch", data: { url: "/api/pincode", status_code: 500 } });
  });
});

describe("noise and volume", () => {
  const ignored = (message: string) => IGNORE_ERRORS.some((p) => (typeof p === "string" ? message.includes(p) : p.test(message)));

  it("ignores errors that aren't the store's", () => {
    for (const m of ["ResizeObserver loop completed with undelivered notifications.", "Script error.", "TypeError: Failed to fetch", "Load failed", "AbortError: The user aborted a request."]) expect(ignored(m)).toBe(true);
    expect(DENY_URLS.some((p) => p.test("chrome-extension://abcdef/content.js"))).toBe(true);
  });

  it("still reports real bugs", () => {
    for (const m of ["TypeError: Cannot read properties of undefined (reading 'price')", "Error: Minified React error #418"]) expect(ignored(m)).toBe(false);
    expect(DENY_URLS.some((p) => p.test("https://sooulone.in/_next/static/chunks/app.js"))).toBe(false);
  });

  it("reports each error once per page, and at most ten", () => {
    const gate = createGate();
    const key = errorKey({ type: undefined, exception: { values: [{ type: "TypeError", value: "x is undefined" }] } });
    expect(key).toBe("TypeError: x is undefined");
    expect(gate(key)).toBe(true);
    expect(gate(key)).toBe(false);
    for (let i = 1; i < MAX_PER_PAGE; i++) expect(gate(`e${i}`)).toBe(true);
    expect(gate("one too many")).toBe(false);
  });
});

describe("forwarding only to our own Sentry project", () => {
  it("works out Sentry's address from our DSN", () => {
    expect(envelopeTarget(header(DSN), DSN)).toBe("https://o42.ingest.us.sentry.io/api/4507/envelope/");
    expect(envelopeTarget(header("https://k@sentry.example.com/sub/7"), "https://k@sentry.example.com/sub/7")).toBe("https://sentry.example.com/sub/api/7/envelope/");
  });

  it("refuses reports for anyone else's project, or garbage", () => {
    expect(envelopeTarget(header("https://abc123@evil.example.com/4507"), DSN)).toBeNull();
    expect(envelopeTarget(header("https://abc123@o42.ingest.us.sentry.io/9999"), DSN)).toBeNull();
    expect(envelopeTarget(header("https://other@o42.ingest.us.sentry.io/4507"), DSN)).toBeNull();
    expect(envelopeTarget("not json\n{}", DSN)).toBeNull();
    expect(envelopeTarget(JSON.stringify({ event_id: "e1" }), DSN)).toBeNull();
  });
});

describe("the /api/errors route", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  const post = (body: string) => new Request("http://localhost/api/errors", { method: "POST", body });

  beforeEach(() => {
    h.limited = false;
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SENTRY_DSN", DSN);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("forwards our project's reports to Sentry", async () => {
    const { POST } = await import("@/app/api/errors/route");
    const res = await POST(post(header(DSN)));
    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledWith("https://o42.ingest.us.sentry.io/api/4507/envelope/", expect.objectContaining({ method: "POST", body: header(DSN) }));
  });

  it("forwards nothing without a DSN, over the rate limit, or for another project", async () => {
    const { POST } = await import("@/app/api/errors/route");
    vi.stubEnv("SENTRY_DSN", "");
    expect((await POST(post(header(DSN)))).status).toBe(204);
    vi.stubEnv("SENTRY_DSN", DSN);
    h.limited = true;
    expect((await POST(post(header(DSN)))).status).toBe(204);
    h.limited = false;
    expect((await POST(post(header("https://abc123@evil.example.com/4507")))).status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes Sentry's 'slow down' back so the browser backs off", async () => {
    const { POST } = await import("@/app/api/errors/route");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "60" } }));
    const res = await POST(post(header(DSN)));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});
