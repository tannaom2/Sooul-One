import { beforeEach, describe, expect, it, vi } from "vitest";
import { canReorder, reorderLines, reorderMessage } from "@/lib/reorder";

/** Benchmark gap R4: "Order again" on a past order (src/lib/reorder.ts). */

const h = vi.hoisted(() => ({
  db: { order: { findUnique: vi.fn() } },
  addToCart: vi.fn(),
  getCustomer: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/analytics", () => ({ recordEvent: vi.fn() }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/server/boxes", () => ({ removeCartBox: vi.fn(), saveCartBox: vi.fn() }));
vi.mock("@/server/customer-auth", () => ({ getCustomer: h.getCustomer }));
vi.mock("@/server/cart", () => ({
  addToCart: h.addToCart,
  getBasketSnapshot: h.snapshot,
  getOrCreateSessionId: async () => "s1",
  readSessionId: async () => "s1",
  removeUnavailable: vi.fn(),
  updateQuantities: vi.fn(),
  updateQuantity: vi.fn(),
  writeBasketCount: vi.fn(),
}));

const BASKET = { count: 3, lines: [] };
const ORDER = {
  status: "DELIVERED",
  accessToken: "tok_abcdef",
  customerId: "c1",
  items: [
    { productId: "p1", productNameSnapshot: "Biotin Gummies", quantity: 2 },
    { productId: "p1", productNameSnapshot: "Biotin Gummies", quantity: 1 }, // same line, second batch
    { productId: "p2", productNameSnapshot: "Kids Multivitamin", quantity: 1 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.db.order.findUnique.mockResolvedValue(ORDER);
  h.snapshot.mockResolvedValue(BASKET);
  h.addToCart.mockResolvedValue("cart");
  h.getCustomer.mockResolvedValue(null);
});

describe("the rules", () => {
  it("puts a line split across batches back together, capped like any basket line", () => {
    expect(reorderLines(ORDER.items)).toEqual([
      { productId: "p1", name: "Biotin Gummies", quantity: 3 },
      { productId: "p2", name: "Kids Multivitamin", quantity: 1 },
    ]);
    expect(reorderLines([{ productId: "p", productNameSnapshot: "X", quantity: 15 }, { productId: "p", productNameSnapshot: "X", quantity: 15 }])[0].quantity).toBe(20);
  });

  it("isn't offered while a payment is pending: that basket is still full", () => {
    expect(canReorder("PENDING_PAYMENT")).toBe(false);
    expect(canReorder("FAILED")).toBe(false);
    expect(canReorder("DELIVERED")).toBe(true);
    expect(canReorder("CANCELLED")).toBe(true);
  });

  it("names what couldn't go back in", () => {
    expect(reorderMessage([], 2)).toBeNull();
    expect(reorderMessage(["Biotin Gummies"], 2)).toBe("Added the rest. Biotin Gummies isn't available just now.");
    expect(reorderMessage(["A", "B", "C", "D"], 5)).toBe("Added the rest. A, B and 2 more aren't available just now.");
    expect(reorderMessage(["A", "B"], 2)).toMatch(/nothing was added/);
  });
});

describe("reorderToBasket", () => {
  it("adds each product once, with the order's quantities, for the order link's token", async () => {
    const { reorderToBasket } = await import("@/app/basket-actions");
    expect(await reorderToBasket("SO-1", "tok_abcdef")).toEqual({ ok: true, basket: BASKET });
    expect(h.addToCart.mock.calls).toEqual([
      ["s1", "p1", 3],
      ["s1", "p2", 1],
    ]);
  });

  it("works without a token for the signed-in shopper the order belongs to", async () => {
    h.getCustomer.mockResolvedValue({ id: "c1" });
    const { reorderToBasket } = await import("@/app/basket-actions");
    expect((await reorderToBasket("SO-1", null)).ok).toBe(true);
  });

  it("answers anyone else as if the order didn't exist, and adds nothing", async () => {
    const { reorderToBasket } = await import("@/app/basket-actions");
    h.getCustomer.mockResolvedValue({ id: "someone-else" });
    expect(await reorderToBasket("SO-1", "tok_wrong!")).toEqual({ ok: false, message: "That order couldn't be found." });
    expect(await reorderToBasket("SO-1", null)).toEqual({ ok: false, message: "That order couldn't be found." });
    h.db.order.findUnique.mockResolvedValue(null);
    expect(await reorderToBasket("SO-404", "tok_abcdef")).toEqual({ ok: false, message: "That order couldn't be found." });
    expect(h.addToCart).not.toHaveBeenCalled();
  });

  it("still adds the rest when one product has sold out, and says which", async () => {
    h.addToCart.mockImplementation(async (_s: string, id: string) => {
      if (id === "p2") throw new Error("That's just sold out.");
      return "cart";
    });
    const { reorderToBasket } = await import("@/app/basket-actions");
    expect(await reorderToBasket("SO-1", "tok_abcdef")).toEqual({ ok: false, message: "Added the rest. Kids Multivitamin isn't available just now.", basket: BASKET });
  });

  it("refuses an order still waiting for its payment", async () => {
    h.db.order.findUnique.mockResolvedValue({ ...ORDER, status: "PENDING_PAYMENT" });
    const { reorderToBasket } = await import("@/app/basket-actions");
    expect((await reorderToBasket("SO-1", "tok_abcdef")).ok).toBe(false);
    expect(h.addToCart).not.toHaveBeenCalled();
  });
});
