import { describe, expect, it, vi } from "vitest";
import { isConnectError, withConnectRetry } from "../src/lib/db-retry";

const noSleep = { sleep: async () => {} };

describe("isConnectError", () => {
  it("recognises failures that happen before a query is sent", () => {
    expect(isConnectError(new Error("Connection terminated due to connection timeout"))).toBe(true);
    expect(isConnectError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isConnectError(Object.assign(new Error("x"), { code: "ETIMEDOUT" }))).toBe(true);
    expect(isConnectError(Object.assign(new Error("x"), { code: "P1001" }))).toBe(true);
  });

  it("looks through wrapped causes", () => {
    const inner = new Error("timeout exceeded when trying to connect");
    expect(isConnectError(new Error("Invalid `db.order.findMany()` invocation", { cause: inner }))).toBe(true);
  });

  it("does not retry anything that may have reached the database", () => {
    expect(isConnectError(new Error("Connection terminated unexpectedly"))).toBe(false);
    expect(isConnectError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(false);
    expect(isConnectError(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))).toBe(false);
    expect(isConnectError(null)).toBe(false);
  });
});

describe("withConnectRetry", () => {
  it("retries connect failures and returns the eventual result", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout exceeded when trying to connect"))
      .mockResolvedValueOnce("ok");
    await expect(withConnectRetry(run, noSleep)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured attempts", async () => {
    const run = vi.fn().mockRejectedValue(new Error("Connection terminated due to connection timeout"));
    await expect(withConnectRetry(run, { ...noSleep, delaysMs: [1, 1] })).rejects.toThrow(/connection timeout/);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("never retries other errors", async () => {
    const run = vi.fn().mockRejectedValue(new Error("Connection terminated unexpectedly"));
    await expect(withConnectRetry(run, noSleep)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
