import { describe, expect, it } from "vitest";
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  looksLikeRecoveryCode,
  normaliseRecoveryCode,
  recoveryCodeFingerprint,
} from "../src/lib/recovery-codes";

describe("generateRecoveryCodes", () => {
  it("makes ten distinct codes in the XXXXX-XXXXX format, without I, L, O or U", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it("never returns a duplicate, even from a random source that repeats", () => {
    let n = 0;
    const repeating = () => Uint8Array.from({ length: 10 }, (_, i) => (Math.floor(n++ / 20) + i) % 256);
    expect(new Set(generateRecoveryCodes(5, repeating)).size).toBe(5);
  });
});

describe("reading a code back", () => {
  it("forgives case, spaces, dashes, and O/I/L typed for 0/1", () => {
    expect(normaliseRecoveryCode("k7pqm-3xw9r")).toBe("K7PQM3XW9R");
    expect(normaliseRecoveryCode(" K7PQM 3XW9R ")).toBe("K7PQM3XW9R");
    expect(normaliseRecoveryCode("O1LI0-AAAAA")).toBe("01110AAAAA");
  });

  it("tells a recovery code from a 6-digit authenticator code", () => {
    expect(looksLikeRecoveryCode("K7PQM-3XW9R")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    expect(looksLikeRecoveryCode("K7PQM-3XW9")).toBe(false);
  });
});

describe("recoveryCodeFingerprint", () => {
  const key = "a-server-secret-of-at-least-32-characters";

  it("matches the same code however it was typed", () => {
    expect(recoveryCodeFingerprint("k7pqm 3xw9r", key)).toBe(recoveryCodeFingerprint("K7PQM-3XW9R", key));
  });

  it("depends on the server secret, so the database alone can't be used to check codes", () => {
    expect(recoveryCodeFingerprint("K7PQM-3XW9R", key)).not.toBe(recoveryCodeFingerprint("K7PQM-3XW9R", key + "x"));
    expect(recoveryCodeFingerprint("K7PQM-3XW9R", key)).not.toContain("K7PQM");
  });
});
