import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce } from "../src/lib/csp";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("contentSecurityPolicy", () => {
  it("runs only scripts carrying this request's nonce, never inline ones", () => {
    const scripts = directive(contentSecurityPolicy("abc123", { dev: false }), "script-src");
    expect(scripts).toContain("'nonce-abc123'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it("allows eval only in development", () => {
    expect(directive(contentSecurityPolicy("n", { dev: true }), "script-src")).toContain("'unsafe-eval'");
    // No https upgrade: it would break a production build on http://localhost (CI).
    expect(contentSecurityPolicy("n", { dev: false })).not.toContain("upgrade-insecure-requests");
  });

  it("lets Razorpay's checkout load, frame and report", () => {
    const csp = contentSecurityPolicy("n", { dev: false });
    expect(directive(csp, "script-src")).toContain("https://checkout.razorpay.com");
    expect(directive(csp, "frame-src")).toContain("https://api.razorpay.com");
    expect(directive(csp, "connect-src")).toContain("https://lumberjack.razorpay.com");
  });

  it("blocks plugins, framing by other sites and base-tag hijacks", () => {
    const csp = contentSecurityPolicy("n", { dev: false });
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});

describe("newNonce", () => {
  it("is 128 bits of base64, different every time", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(new Set(Array.from({ length: 50 }, newNonce)).size).toBe(50);
  });
});
