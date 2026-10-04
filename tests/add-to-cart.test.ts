import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * addToCart's quantity rules (src/server/cart.ts), including "Order again"'s
 * top-up, and one line per product even when two adds land at once.
 */

const h = vi.hoisted(() => ({
  db: {
    cart: { upsert: vi.fn(async () => ({ id: "cart1" })) },
    product: { findUnique: vi.fn() },
    cartItem: { upsert: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: h.db }));

const PRODUCT = {
  id: "p1",
  isActive: true,
  retailOnly: false,
  brand: { isActive: true },
  category: { isActive: true },
  regulatoryType: "PACKAGED_FOOD",
  shelfLifeDays: 180,
  stockQuantity: 50,
  lowStockThreshold: 5,
  price: 199,
  discountPrice: null,
  discountActive: false,
  batches: [{ id: "b1", batchNumber: "B1", expiresOn: new Date("2030-01-01"), quantityRemaining: 50 }],
};

// The basket module is large; load it once up front so a busy full run doesn't time out the first test.
beforeAll(async () => {
  await import("@/server/cart");
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  h.db.product.findUnique.mockResolvedValue(PRODUCT);
});

describe("adding to the basket", () => {
  const LINE = { where: { cartId_productId: { cartId: "cart1", productId: "p1" } }, select: { id: true, quantity: true } };

  it("makes the line or adds to it in one statement, capped at 20", async () => {
    const { addToCart } = await import("@/server/cart");
    h.db.cartItem.upsert.mockResolvedValue({ id: "i1", quantity: 5 });
    await addToCart("s1", "p1", 3);
    expect(h.db.cartItem.upsert).toHaveBeenCalledWith({
      ...LINE,
      create: { cartId: "cart1", productId: "p1", quantity: 3, priceAtAdd: expect.any(String) },
      update: { priceAtAdd: expect.any(String), quantity: { increment: 3 } },
    });
    expect(h.db.cartItem.updateMany).not.toHaveBeenCalled();

    h.db.cartItem.upsert.mockResolvedValue({ id: "i1", quantity: 22 });
    await addToCart("s1", "p1", 3);
    expect(h.db.cartItem.updateMany).toHaveBeenCalledWith({ where: { id: "i1", quantity: { gt: 20 } }, data: { quantity: 20 } });
  });

  it("with atLeast, tops the line up instead, so ordering again twice doesn't double it", async () => {
    const { addToCart } = await import("@/server/cart");
    h.db.cartItem.upsert.mockResolvedValue({ id: "i1", quantity: 3 });
    await addToCart("s1", "p1", 3, { atLeast: true });
    expect(h.db.cartItem.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { priceAtAdd: expect.any(String) } }));
    expect(h.db.cartItem.updateMany).not.toHaveBeenCalled();

    h.db.cartItem.upsert.mockResolvedValue({ id: "i1", quantity: 1 });
    await addToCart("s1", "p1", 3, { atLeast: true });
    expect(h.db.cartItem.updateMany).toHaveBeenCalledWith({ where: { id: "i1", quantity: { lt: 3 } }, data: { quantity: 3 } });

    vi.clearAllMocks();
    h.db.product.findUnique.mockResolvedValue(PRODUCT);
    h.db.cartItem.upsert.mockResolvedValue({ id: "i1", quantity: 5 });
    await addToCart("s1", "p1", 3, { atLeast: true });
    expect(h.db.cartItem.updateMany).not.toHaveBeenCalled();
  });

  it("when a same-moment add wins the insert, adds to its line instead of failing or making a second", async () => {
    const { addToCart } = await import("@/server/cart");
    h.db.cartItem.upsert.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" })).mockResolvedValueOnce({ id: "i1", quantity: 2 });
    await expect(addToCart("s1", "p1", 1)).resolves.toBe("cart1");
    expect(h.db.cartItem.upsert).toHaveBeenCalledTimes(2);
    expect(h.db.cartItem.upsert.mock.calls[1][0]).toEqual(h.db.cartItem.upsert.mock.calls[0][0]);
  });

  it("passes other database errors on", async () => {
    const { addToCart } = await import("@/server/cart");
    h.db.cartItem.upsert.mockRejectedValueOnce(Object.assign(new Error("connection lost"), { code: "P1001" }));
    await expect(addToCart("s1", "p1", 1)).rejects.toThrow("connection lost");
    expect(h.db.cartItem.upsert).toHaveBeenCalledTimes(1);
  });

  it("refuses what can't be sold or sent", async () => {
    const { addToCart } = await import("@/server/cart");
    h.db.product.findUnique.mockResolvedValueOnce({ ...PRODUCT, isActive: false });
    await expect(addToCart("s1", "p1", 1)).rejects.toThrow("isn't available");
    h.db.product.findUnique.mockResolvedValueOnce({ ...PRODUCT, retailOnly: true });
    await expect(addToCart("s1", "p1", 1)).rejects.toThrow("stores only");
    h.db.product.findUnique.mockResolvedValueOnce({ ...PRODUCT, stockQuantity: 0, batches: [] });
    await expect(addToCart("s1", "p1", 1)).rejects.toThrow("sold out");
  });
});
