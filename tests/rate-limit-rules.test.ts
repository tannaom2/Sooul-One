import { describe, expect, it } from "vitest";
import { SIGN_IN_LIMITS, clientIp, signInBlocked, signInKeys } from "../src/lib/rate-limit-rules";

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

describe("clientIp", () => {
  it("prefers the headers Cloudflare sets over X-Forwarded-For", () => {
    expect(clientIp(headers({ "true-client-ip": "81.97.145.24", "x-forwarded-for": "6.6.6.6, 10.0.0.1" }))).toBe("81.97.145.24");
    expect(clientIp(headers({ "cf-connecting-ip": "81.97.145.24", "x-forwarded-for": "6.6.6.6" }))).toBe("81.97.145.24");
  });

  it("takes the first X-Forwarded-For entry, where Render puts the client", () => {
    expect(clientIp(headers({ "x-forwarded-for": " 81.97.145.24 , 172.71.195.123, 10.226.90.65" }))).toBe("81.97.145.24");
  });

  it("calls a request with no proxy headers local, and caps the length", () => {
    expect(clientIp(headers({}))).toBe("local");
    expect(clientIp(headers({ "x-real-ip": "x".repeat(500) }))).toHaveLength(64);
  });
});

describe("sign-in limits", () => {
  const ok = { accountFromIp: 1, ip: 1, account: 1 };

  it("keys the per-account lock on the caller's IP, so strangers can't lock the owner out", () => {
    const attacker = signInKeys("owner@x.in", "6.6.6.6");
    const owner = signInKeys("owner@x.in", "81.97.145.24");
    expect(attacker.accountFromIp).not.toBe(owner.accountFromIp);
    expect(attacker.account).toBe(owner.account);
  });

  it("allows up to each limit and blocks one past it", () => {
    expect(signInBlocked(ok)).toBe(false);
    expect(signInBlocked({ ...ok, accountFromIp: SIGN_IN_LIMITS.accountFromIp.max })).toBe(false);
    expect(signInBlocked({ ...ok, accountFromIp: SIGN_IN_LIMITS.accountFromIp.max + 1 })).toBe(true);
    expect(signInBlocked({ ...ok, ip: SIGN_IN_LIMITS.ip.max + 1 })).toBe(true);
    expect(signInBlocked({ ...ok, account: SIGN_IN_LIMITS.account.max + 1 })).toBe(true);
  });

  it("gives a blank email its own key", () => {
    expect(signInKeys("", "1.1.1.1").account).toBe("signin:acct:(blank)");
  });
});
