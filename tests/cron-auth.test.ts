import { describe, expect, it } from "vitest";
import { cronAuthorized } from "../src/lib/cron-auth";

const SECRET = "cron-secret-for-tests";
const h = (init: Record<string, string>) => new Headers(init);

describe("cronAuthorized", () => {
  it("accepts the secret as a bearer token or in x-cron-secret", () => {
    expect(cronAuthorized(h({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true);
    expect(cronAuthorized(h({ "x-cron-secret": SECRET }), SECRET)).toBe(true);
  });

  it("refuses a wrong or missing secret", () => {
    expect(cronAuthorized(h({ authorization: "Bearer nope" }), SECRET)).toBe(false);
    expect(cronAuthorized(h({}), SECRET)).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    expect(cronAuthorized(h({ authorization: "Bearer " }), undefined)).toBe(false);
    expect(cronAuthorized(h({ "x-cron-secret": "" }), "")).toBe(false);
  });
});
