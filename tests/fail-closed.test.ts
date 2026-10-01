import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Launch defect D4: a database error must never reopen a paused store, turn
 * COD back on or blank the seller's details, and must never be cached.
 */

const h = vi.hoisted(() => ({
  storeSettings: { findUnique: vi.fn() },
  businessProfile: { findUnique: vi.fn() },
  pincodeRule: { findUnique: vi.fn() },
  order: { count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) },
}));

vi.mock("server-only", () => ({}));
// unstable_cache stores only what resolves; a thrown error is never kept. Pass-through models that.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/db", () => ({ db: h }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/server/launch-readiness", () => ({ ordersOpen: async () => true }));

const PAUSED = { ordersPaused: true, pauseMessage: "Back Monday", codEnabled: false, bundlesEnabled: true };
const down = () => Promise.reject(new Error("DatabaseNotReachable"));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("withLastGood", () => {
  it("answers from the last good read on an error, else the fallback, else rethrows", async () => {
    const { withLastGood } = await import("@/server/last-good");
    const load = vi.fn<() => Promise<number>>();
    const safe = withLastGood("t", load, () => -1);
    const strict = withLastGood("t", load, "throw");
    load.mockRejectedValueOnce(new Error("x"));
    expect(await safe()).toBe(-1);
    load.mockRejectedValueOnce(new Error("x"));
    await expect(strict()).rejects.toThrow("x");
    load.mockResolvedValueOnce(7);
    expect(await safe()).toBe(7);
    load.mockRejectedValueOnce(new Error("x"));
    expect(await safe()).toBe(7);
  });
});

describe("store controls", () => {
  it("holds orders when the settings can't be read and never were", async () => {
    h.storeSettings.findUnique.mockImplementation(down);
    const { getStoreControls } = await import("@/server/store-settings");
    expect(await getStoreControls()).toMatchObject({ ordersPaused: true, codEnabled: false });
  });

  it("keeps a paused store paused through a database error", async () => {
    h.storeSettings.findUnique.mockResolvedValueOnce(PAUSED).mockImplementation(down);
    const { getStoreControls } = await import("@/server/store-settings");
    expect(await getStoreControls()).toMatchObject({ ordersPaused: true, pauseMessage: "Back Monday" });
    expect(await getStoreControls()).toMatchObject({ ordersPaused: true, pauseMessage: "Back Monday" });
  });

  it("picks the real settings up again as soon as the database answers (the error was never cached)", async () => {
    h.storeSettings.findUnique.mockImplementationOnce(down).mockResolvedValue({ ...PAUSED, ordersPaused: false });
    const { getStoreControls } = await import("@/server/store-settings");
    expect((await getStoreControls()).ordersPaused).toBe(true);
    expect((await getStoreControls()).ordersPaused).toBe(false);
  });
});

describe("cash on delivery at checkout", () => {
  it("is refused, not allowed, when the rules can't be read", async () => {
    h.storeSettings.findUnique.mockImplementation(down);
    const { codForCheckout } = await import("@/server/intel");
    expect(await codForCheckout("380015", 50_000)).toMatchObject({ allowed: false, reason: "UNAVAILABLE" });
  });

  it("is refused when a pincode rule can't be read", async () => {
    h.storeSettings.findUnique.mockResolvedValue({ codAutoBlock: false, codAutoBlockRtoPercent: 35, codAutoBlockMinShipped: 4, codMinOrderValue: null, codMaxOrderValue: null, preferredPayment: "ONLINE" });
    h.pincodeRule.findUnique.mockImplementation(down);
    const { codForCheckout } = await import("@/server/intel");
    expect((await codForCheckout("380015", 50_000)).allowed).toBe(false);
  });

  it("still applies the owner's minimum through an error, from the last good read", async () => {
    h.storeSettings.findUnique
      .mockResolvedValueOnce({ codAutoBlock: false, codAutoBlockRtoPercent: 35, codAutoBlockMinShipped: 4, codMinOrderValue: 399, codMaxOrderValue: null, preferredPayment: "ONLINE" })
      .mockImplementation(down);
    h.pincodeRule.findUnique.mockResolvedValue(null);
    const { codForCheckout } = await import("@/server/intel");
    expect((await codForCheckout("380015", 20_000)).allowed).toBe(false); // ₹200, under ₹399
    expect(await codForCheckout("380015", 20_000)).toMatchObject({ allowed: false, reason: "UNDER_MIN" });
  });
});

describe("business details", () => {
  it("keep the last good details (GSTIN included) through a database error", async () => {
    h.businessProfile.findUnique.mockResolvedValueOnce({ legalName: "SooulOne Consumer Brands Pvt Ltd", gstin: "24AAKCS4821M1ZX" }).mockImplementation(down);
    const { getBusinessProfile } = await import("@/server/business");
    await getBusinessProfile();
    expect((await getBusinessProfile()).gstin).toBe("24AAKCS4821M1ZX");
  });
});
