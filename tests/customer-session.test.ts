import { describe, expect, it } from "vitest";
import { renewedExpiry } from "../src/lib/customer-session";

const DAY = 86_400_000;
const NOW = new Date("2026-09-28T12:00:00Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

describe("sliding shopper sessions", () => {
  it("leaves a session with plenty of time left alone (no write on every page)", () => {
    expect(renewedExpiry({ createdAt: at(-10), expiresAt: at(80) }, NOW)).toBeNull();
  });

  it("extends a session in use to 90 days from now once under 60 days remain", () => {
    expect(renewedExpiry({ createdAt: at(-40), expiresAt: at(50) }, NOW)).toEqual(at(90));
  });

  it("never extends past a year from sign-in: then a fresh code is asked for", () => {
    expect(renewedExpiry({ createdAt: at(-300), expiresAt: at(20) }, NOW)).toEqual(at(65));
    expect(renewedExpiry({ createdAt: at(-365), expiresAt: at(1) }, NOW)).toBeNull();
  });

  it("never revives a session that has already ended", () => {
    expect(renewedExpiry({ createdAt: at(-100), expiresAt: at(-1) }, NOW)).toBeNull();
  });
});
