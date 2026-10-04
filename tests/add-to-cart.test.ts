import { beforeEach, describe, expect, it, vi } from "vitest";

/** addToCart's quantity rules (src/server/cart.ts), including "Order again"'s top-up. */

const h = vi.hoisted(() => ({
  db: {
    cart: { upsert: vi.fn(async () => ({ id: "cart1" })) },
    product: { findUnique: vi.fn() },
    cartItem: { findFirst: vi.fn(), update: vi.fn(async () => ({})), create: vi.fn(async () => ({})) },
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

beforeEach(() => {
  vi.clearAllMocks();
  h.db.product.findUnique.mockResolvedValue(PRODUCT);
});

describe("adding to the basket", () => {
  it("adds on top of what's there, capped at 20", async () => {
    const { addToCart } = await import("@/server/cart");
    h.db.cartItem.findFirst.mockResolvedValue({ id: "i1", quantity: 2 });
    await addToCart("s1", "p1", 3);
    expect(h.db.cartItem.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: expect.objectContaining({ quantity: 5 }) });
    h.db.cartItem.findFirst.mockResolvedValue({ id: "i1", quantity: 19 });
    await addToCart("s1", "p1", 3);
    expect(h.db.cartItem.update).toHaveBeenLastCalledWith({ where: { id: "i1" }, data: expect.objectContaining({ quantity: 20 }) });
  });

  it("with atLeast, tops the line up instead, so ordering again twice doesn't double it", async () => {
    const { addToCart } = await import("@/server/cart");
    h.db.cartItem.findFirst.mockResolvedValue({ id: "i1", quantity: 3 });
    await addToCart("s1", "p1", 3, { atLeast: true });
    expect(h.db.cartItem.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: expect.objectContaining({ quantity: 3 }) });
    h.db.cartItem.findFirst.mockResolvedValue({ id: "i1", quantity: 1 });
    await addToCart("s1", "p1", 3, { atLeast: true });
    expect(h.db.cartItem.update).toHaveBeenLastCalledWith({ where: { id: "i1" }, data: expect.objectContaining({ quantity: 3 }) });
    h.db.cartItem.findFirst.mockResolvedValue({ id: "i1", quantity: 5 });
    await addToCart("s1", "p1", 3, { atLeast: true });
    expect(h.db.cartItem.update).toHaveBeenLastCalledWith({ where: { id: "i1" }, data: expect.objectContaining({ quantity: 5 }) });
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
