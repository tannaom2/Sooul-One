import { describe, expect, it } from "vitest";
import { newOrderAccessToken, orderStatusUrl, orderTokenMatches } from "../src/lib/order-access";

describe("orderStatusUrl", () => {
  it("builds the private order link from the site URL", () => {
    expect(orderStatusUrl("SO-MU66-0T", "abc_-1", "https://soulone.example/")).toBe(
      "https://soulone.example/order/SO-MU66-0T?t=abc_-1",
    );
  });

  it("encodes anything unexpected in the order number", () => {
    expect(orderStatusUrl("SO 1/2", "t", "https://x.example")).toBe("https://x.example/order/SO%201%2F2?t=t");
  });

  it("returns null for orders placed before tokens existed", () => {
    expect(orderStatusUrl("SO-1", null, "https://x.example")).toBeNull();
    expect(orderStatusUrl("SO-1", "", "https://x.example")).toBeNull();
  });
});

describe("order access tokens", () => {
  it("generates distinct, URL-safe, 128-bit tokens", () => {
    const tokens = new Set(Array.from({ length: 200 }, newOrderAccessToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it("matches only the exact token", () => {
    const token = newOrderAccessToken();
    expect(orderTokenMatches(token, token)).toBe(true);
    expect(orderTokenMatches(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), token)).toBe(false);
    expect(orderTokenMatches(token.slice(1), token)).toBe(false);
  });

  it("rejects a missing token or an order that has none", () => {
    expect(orderTokenMatches(undefined, "abc")).toBe(false);
    expect(orderTokenMatches("", "abc")).toBe(false);
    expect(orderTokenMatches("abc", null)).toBe(false);
  });
});
