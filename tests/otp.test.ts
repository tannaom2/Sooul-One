import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  RESEND_AFTER_SECONDS,
  codeDelivery,
  codeMatches,
  hashCode,
  newCode,
  resendWait,
} from "../src/lib/otp";
import { maskMobile, normaliseMobile } from "../src/lib/mobile";
import { otpKeys } from "../src/lib/rate-limit-rules";

const SECRET = "x".repeat(40);

describe("sign-in codes", () => {
  it("are six digits, leading zeros kept", () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(new RegExp(`^\\d{${CODE_LENGTH}}$`));
  });

  it("match only the right code, for the same challenge and number", () => {
    const stored = hashCode("004271", "ch-1", "9876543210", SECRET);
    expect(codeMatches("004271", "ch-1", "9876543210", SECRET, stored)).toBe(true);
    expect(codeMatches("004272", "ch-1", "9876543210", SECRET, stored)).toBe(false);
    // Bound to its challenge and number: no replay elsewhere.
    expect(codeMatches("004271", "ch-2", "9876543210", SECRET, stored)).toBe(false);
    expect(codeMatches("004271", "ch-1", "9123456780", SECRET, stored)).toBe(false);
    // And to the server's key: a leaked table alone can't be checked offline.
    expect(codeMatches("004271", "ch-1", "9876543210", "y".repeat(40), stored)).toBe(false);
  });

  it("refuse anything that isn't exactly six digits", () => {
    const stored = hashCode("123456", "ch-1", "9876543210", SECRET);
    for (const bad of ["", "12345", "1234567", "12345a", " 123456"]) {
      expect(codeMatches(bad, "ch-1", "9876543210", SECRET, stored)).toBe(false);
    }
  });

  it("are stored as a keyed hash, never the code itself", () => {
    const stored = hashCode("123456", "ch-1", "9876543210", SECRET);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain("123456");
  });
});

describe("resend wait", () => {
  const now = new Date("2026-09-27T10:00:30Z");
  it("is zero with no earlier code", () => expect(resendWait(null, now)).toBe(0));
  it("counts down from the last code", () => {
    expect(resendWait(new Date("2026-09-27T10:00:20Z"), now)).toBe(RESEND_AFTER_SECONDS - 10);
    expect(resendWait(new Date("2026-09-27T10:00:00Z"), now)).toBe(0);
  });
});

describe("mobile numbers", () => {
  it("accept the ways Indians type them", () => {
    for (const typed of ["9876543210", "98765 43210", "+91 98765 43210", "919876543210", "09876543210", "98765-43210"]) {
      expect(normaliseMobile(typed)).toBe("9876543210");
    }
  });

  it("refuse landlines, short numbers and foreign numbers", () => {
    for (const typed of ["", "12345", "5876543210", "0791234567", "+44 7700 900123", "98765432101"]) {
      expect(normaliseMobile(typed)).toBeNull();
    }
  });

  it("mask the middle", () => expect(maskMobile("9876543210")).toBe("98•••••210"));
});

describe("how codes are delivered", () => {
  const provider = { MSG91_AUTH_KEY: "k", MSG91_OTP_TEMPLATE_ID: "t" };

  it("uses SMS whenever a provider is set up, anywhere", () => {
    expect(codeDelivery({ ...provider, NODE_ENV: "production", SITE_URL: "https://sooulone.in", RENDER: "true" })).toBe("sms");
  });

  it("shows the code on screen on the owner's own machine: local development, or the demo's flag", () => {
    expect(codeDelivery({ NODE_ENV: "development" })).toBe("screen");
    expect(codeDelivery({ NODE_ENV: "production", SITE_URL: "http://localhost:3000", SMS_SHOW_CODES: "1" })).toBe("screen");
  });

  it("never shows codes on a hosted server, whatever the flags say", () => {
    expect(codeDelivery({ NODE_ENV: "production", SITE_URL: "https://sooulone.in", SMS_SHOW_CODES: "1" })).toBe("off");
    expect(codeDelivery({ NODE_ENV: "development", SITE_URL: "http://localhost:3000", RENDER: "true", SMS_SHOW_CODES: "1" })).toBe("off");
    expect(codeDelivery({ NODE_ENV: "development", SITE_URL: "not a url" })).toBe("off");
  });

  it("is off in a production build with no provider and no flag (CI, a plain next start)", () => {
    expect(codeDelivery({ NODE_ENV: "production", SITE_URL: "http://localhost:3000" })).toBe("off");
    expect(codeDelivery({ MSG91_AUTH_KEY: "k", NODE_ENV: "production" })).toBe("off");
  });
});

describe("code rate-limit keys", () => {
  it("count per number and per connection separately", () => {
    const keys = otpKeys("9876543210", "1.2.3.4");
    expect(new Set(Object.values(keys)).size).toBe(3);
    expect(keys.sendPerPhone).toContain("9876543210");
    expect(keys.sendPerIp).toContain("1.2.3.4");
  });
});
