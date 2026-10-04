import { beforeEach, describe, expect, it, vi } from "vitest";
import { boxFallbackMessage, canReorder, looseLines, offerReorder, orderBoxes, partialNote, reorderLines, reorderMessage } from "@/lib/reorder";

/** Benchmark gap R4: "Order again" on a past order (src/lib/reorder.ts). */

const h = vi.hoisted(() => ({
  db: { order: { findUnique: vi.fn() }, cartBox: { findMany: vi.fn(async () => [] as unknown[]) } },
  addToCart: vi.fn(),
  getCustomer: vi.fn(),
  snapshot: vi.fn(),
  saveCartBox: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/analytics", () => ({ recordEvent: vi.fn() }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/server/boxes", () => ({ removeCartBox: vi.fn(), saveCartBox: h.saveCartBox }));
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

  it("is offered once an order is on its way or done with, on the order page and the account page alike", () => {
    expect(["PAID", "PROCESSING", "PENDING_PAYMENT", "FAILED"].map(offerReorder)).toEqual([false, false, false, false]);
    expect(["SHIPPED", "DELIVERED", "CANCELLED", "RTO", "RETURNED", "REFUNDED"].every(offerReorder)).toBe(true);
  });

  it("names what couldn't go back in", () => {
    expect(reorderMessage([], 2)).toBeNull();
    expect(reorderMessage(["Biotin Gummies"], 2)).toBe("Added the rest. Biotin Gummies isn't available just now.");
    expect(reorderMessage(["A", "B", "C", "D"], 5)).toBe("Added the rest. A, B and 2 more aren't available just now.");
    expect(reorderMessage(["A", "B"], 2)).toMatch(/nothing was added/);
  });
});

describe("boxes in the order", () => {
  const BOX = { boxId: "b1", name: "Gummies Box", picks: [{ productId: "g1", quantity: 1 }, { productId: "g2", quantity: 1 }, { productId: "g3", quantity: 1 }] };
  const BOX_ORDER = {
    ...ORDER,
    boxSnapshot: [BOX],
    items: [
      { productId: "g1", productNameSnapshot: "Calcium Gummies", quantity: 1 },
      { productId: "g2", productNameSnapshot: "Omega Gummies", quantity: 1 },
      { productId: "g3", productNameSnapshot: "Men's Daily", quantity: 2 }, // one in the box, one bought on its own
    ],
  };

  it("reads the recorded boxes and leaves out what they account for", () => {
    expect(orderBoxes([BOX, { boxId: "", picks: [] }, "junk"])).toEqual([BOX]);
    expect(orderBoxes(null)).toEqual([]);
    expect(looseLines(reorderLines(BOX_ORDER.items), [BOX])).toEqual([{ productId: "g3", name: "Men's Daily", quantity: 1 }]);
  });

  it("puts a box back as a box, and the rest back loose", async () => {
    const { reorderToBasket } = await import("@/app/basket-actions");
    h.db.order.findUnique.mockResolvedValue(BOX_ORDER);
    h.saveCartBox.mockResolvedValue({ ok: true });
    expect(await reorderToBasket("SO-1", "tok_abcdef")).toEqual({ ok: true, basket: BASKET });
    expect(h.saveCartBox).toHaveBeenCalledWith("s1", { boxId: "b1", picks: BOX.picks });
    expect(h.addToCart.mock.calls).toEqual([["s1", "g3", 1, { atLeast: true }]]);
  });

  it("doesn't add a box that's already in the basket with the same picks", async () => {
    const { reorderToBasket } = await import("@/app/basket-actions");
    h.db.order.findUnique.mockResolvedValue(BOX_ORDER);
    h.db.cartBox.findMany.mockResolvedValueOnce([{ boxId: "b1", items: [{ productId: "g3", quantity: 1 }, { productId: "g1", quantity: 1 }, { productId: "g2", quantity: 1 }] }]);
    expect(await reorderToBasket("SO-1", "tok_abcdef")).toEqual({ ok: true, basket: BASKET });
    expect(h.saveCartBox).not.toHaveBeenCalled();
    expect(h.addToCart.mock.calls).toEqual([["s1", "g3", 1, { atLeast: true }]]);
  });

  it("adds a box's items loose when it can't go back as a box, and says why", async () => {
    const { reorderToBasket } = await import("@/app/basket-actions");
    h.db.order.findUnique.mockResolvedValue(BOX_ORDER);
    h.saveCartBox.mockResolvedValue({ ok: false, message: "This box isn't available any more." });
    const result = await reorderToBasket("SO-1", "tok_abcdef");
    expect(result).toMatchObject({ ok: false, message: boxFallbackMessage("Gummies Box", "This box isn't available any more.") });
    expect(h.addToCart.mock.calls).toEqual([["s1", "g3", 2, { atLeast: true }], ["s1", "g1", 1, { atLeast: true }], ["s1", "g2", 1, { atLeast: true }]]);
    expect(boxFallbackMessage("Gummies Box", "Omega Gummies has just sold out. Swap it for another.")).toBe(
      "Gummies Box couldn't go back in as a box (Omega Gummies has just sold out), so its items were added at their own prices. Rebuild it on the box page for the box price.",
    );
  });
});

describe("reorderToBasket", () => {
  it("adds each product once, with the order's quantities, for the order link's token", async () => {
    const { reorderToBasket } = await import("@/app/basket-actions");
    expect(await reorderToBasket("SO-1", "tok_abcdef")).toEqual({ ok: true, basket: BASKET });
    expect(h.addToCart.mock.calls).toEqual([
      ["s1", "p1", 3, { atLeast: true }],
      ["s1", "p2", 1, { atLeast: true }],
    ]);
  });

  it("tops lines up to the order's quantities instead of adding on top, so pressing twice doesn't double the basket", async () => {
    // The atLeast rule itself lives in addToCart (src/server/cart.ts); every reorder line uses it.
    const { reorderToBasket } = await import("@/app/basket-actions");
    await reorderToBasket("SO-1", "tok_abcdef");
    await reorderToBasket("SO-1", "tok_abcdef");
    expect(h.addToCart.mock.calls.every((c) => (c[3] as { atLeast?: boolean } | undefined)?.atLeast === true)).toBe(true);
  });

  it("says when the basket can only partly fill a line today", async () => {
    const { reorderToBasket } = await import("@/app/basket-actions");
    h.snapshot.mockResolvedValue({ ...BASKET, lines: [{ productId: "p1", name: "Biotin Gummies", status: "PARTIAL", quantityAvailable: 1 }] });
    expect(await reorderToBasket("SO-1", "tok_abcdef")).toMatchObject({ ok: false, message: "Only 1 of Biotin Gummies can be sent right now." });
    expect(partialNote([{ productId: "x", name: "X", status: "PARTIAL", quantityAvailable: 2 }], ["p1"])).toBeNull();
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
