import { describe, expect, it } from "vitest";
import { isUndeliverableTestAddress } from "../src/lib/email-recipient";

describe("isUndeliverableTestAddress", () => {
  it("catches reserved and test domains, so test orders never bounce real mail", () => {
    for (const a of ["h3@soulone.test", "e2e-tester@example.com", "x@sub.example.org", "a@foo.invalid", "b@localhost", "c@EXAMPLE.IN"]) {
      expect(isUndeliverableTestAddress(a)).toBe(true);
    }
  });

  it("lets real addresses through", () => {
    for (const a of ["tannaom2@gmail.com", "orders@sooulone.in", "someone@testing.co.in", "ops@examples.com"]) {
      expect(isUndeliverableTestAddress(a)).toBe(false);
    }
  });
});
