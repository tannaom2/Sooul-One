import { describe, expect, it } from "vitest";
import { newOrderAccessToken, orderTokenMatches } from "../src/lib/order-access";

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
