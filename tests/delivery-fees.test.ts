import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildQuote, DEFAULT_SHIPPING_POLICY, shippingPolicyFrom, type QuoteLineInput } from "@/lib/checkout/quote";
import { storeFacts } from "@/lib/site-content";
import { toPaise } from "@/lib/money";

/**
 * Benchmark gap M6: the delivery fee and free-delivery amount are set from
 * Store controls. Checkout, the basket bar and copy {tokens} read one policy.
 */

const h = vi.hoisted(() => ({ storeSettings: { findUnique: vi.fn() } }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/db", () => ({ db: h }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/server/launch-readiness", () => ({ ordersOpen: async () => true }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

const item = (rupees: string): QuoteLineInput => ({
  productId: "p",
  name: "Biotin Gummies",
  regulatoryType: "HEALTH_SUPPLEMENT",
  unitPricePaise: toPaise(rupees),
  quantity: 1,
  taxRatePercent: 18,
  shelfLifeDays: 730,
  batches: [{ id: "G1", batchNumber: "G1", expiresOn: new Date("2027-06-01T00:00:00Z"), quantityRemaining: 20 }],
});
const quote = (rupees: string, fees: { deliveryFee: number; freeDeliveryAbove: number }) =>
  buildQuote({ lines: [item(rupees)], estimatedDeliveryDate: new Date("2026-06-01T00:00:00Z"), gstTreatment: "INTRA_STATE", shipping: shippingPolicyFrom(fees) });

describe("the owner's fees", () => {
  it("charge the set fee below the set amount, and nothing from it", () => {
    expect(quote("499", { deliveryFee: 40, freeDeliveryAbove: 500 }).shippingPaise).toBe(toPaise("40"));
    expect(quote("500", { deliveryFee: 40, freeDeliveryAbove: 500 }).shippingPaise).toBe(0);
  });

  it("make delivery free on every order with a ₹0 fee or a ₹0 amount", () => {
    expect(quote("99", { deliveryFee: 0, freeDeliveryAbove: 799 }).shippingPaise).toBe(0);
    expect(quote("99", { deliveryFee: 59, freeDeliveryAbove: 0 }).shippingPaise).toBe(0);
  });

  it("keep GST on delivery at the rate in code", () => {
    expect(shippingPolicyFrom({ deliveryFee: 40, freeDeliveryAbove: 500 }).taxRatePercent).toBe(DEFAULT_SHIPPING_POLICY.taxRatePercent);
  });

  it("fill {deliveryFee} and {freeDelivery} in copy", () => {
    const facts = storeFacts(shippingPolicyFrom({ deliveryFee: 40, freeDeliveryAbove: 999 }));
    expect(facts.deliveryFee).toBe("₹40/-");
    expect(facts.freeDelivery).toBe("₹999/-");
  });
});

describe("reading the fees", () => {
  it("uses the saved fees", async () => {
    h.storeSettings.findUnique.mockResolvedValue({ deliveryFee: 49, freeDeliveryAbove: 999 });
    const { getShippingPolicy } = await import("@/server/store-settings");
    expect(await getShippingPolicy()).toMatchObject({ flatRatePaise: toPaise("49"), freeAbovePaise: toPaise("999") });
  });

  it("keeps the last fees read through a database error, and starts from the defaults", async () => {
    h.storeSettings.findUnique
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({ deliveryFee: 49, freeDeliveryAbove: 999 })
      .mockRejectedValue(new Error("down"));
    const { getShippingPolicy } = await import("@/server/store-settings");
    expect(await getShippingPolicy()).toEqual(DEFAULT_SHIPPING_POLICY);
    await getShippingPolicy();
    expect((await getShippingPolicy()).freeAbovePaise).toBe(toPaise("999"));
  });
});
