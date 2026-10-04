import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SAVED_ADDRESSES, addressSummary, sameAddress } from "@/lib/saved-addresses";
import { cleanBoxName, parsePicks } from "@/lib/saved-boxes";
import { alertLive, stockAlertKey } from "@/lib/stock-alerts";

/** Saved addresses, saved boxes and back-in-stock alerts (Sprint 4). */

const h = vi.hoisted(() => ({
  db: {
    address: { findMany: vi.fn(), update: vi.fn((a: unknown) => a), create: vi.fn((a: unknown) => a), deleteMany: vi.fn((a: unknown) => a) },
    box: { findUnique: vi.fn() },
    savedBox: { count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: "sb1" })), findMany: vi.fn(async () => [] as unknown[]) },
    product: { findMany: vi.fn(async () => [] as unknown[]), findUnique: vi.fn() },
    stockAlert: { findMany: vi.fn(async () => [] as unknown[]), findUnique: vi.fn(), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })), upsert: vi.fn((a: unknown) => a) },
    consentRecord: { create: vi.fn((a: unknown) => a) },
    outboundMessage: { createMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(h.db) : arg)),
  },
  emailsSend: vi.fn(async () => ({ error: null })),
  expireTag: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.emailsSend }; } }));
vi.mock("@/lib/cache-tags", () => ({ CATALOG_TAG: "catalog", BUSINESS_TAG: "business", SETTINGS_TAG: "settings", STORES_TAG: "stores", PINCODE_TAG: "pincodes", CONTENT_TAG: "content", expireTag: h.expireTag, refreshTag: vi.fn() }));
vi.mock("@/server/messages", () => ({
  enqueueMessage: async (client: { outboundMessage: { createMany: (a: unknown) => Promise<{ count: number }> } }, ...m: unknown[]) =>
    (await client.outboundMessage.createMany({ data: m, skipDuplicates: true })).count,
  processMessages: vi.fn(async () => []),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://sooulone.in";
});

const ADDR = { name: "Asha Rao", line1: "Flat 4, Shanti Nagar", line2: null, city: "Ahmedabad", state: "Gujarat", postalCode: "380015", phone: "9824011223" };

describe("address book", () => {
  it("treats the same door as the same address, whatever the case, spaces or commas", () => {
    expect(sameAddress(ADDR, { line1: "flat 4  shanti nagar", line2: "", postalCode: "380015" })).toBe(true);
    expect(sameAddress(ADDR, { line1: "Flat 5, Shanti Nagar", line2: null, postalCode: "380015" })).toBe(false);
    expect(sameAddress(ADDR, { line1: "Flat 4, Shanti Nagar", line2: null, postalCode: "380016" })).toBe(false);
    expect(addressSummary(ADDR)).toBe("Asha Rao, Flat 4, Shanti Nagar, Ahmedabad 380015");
  });

  it("updates a known address and moves it to the top, instead of saving it twice", async () => {
    const { rememberAddress } = await import("@/server/saved-addresses");
    h.db.address.findMany.mockResolvedValue([{ id: "a1", line1: "FLAT 4 SHANTI NAGAR", line2: null, postalCode: "380015" }]);
    const now = new Date("2026-10-04T10:00:00Z");
    await rememberAddress("c1", { ...ADDR, name: "Asha R" }, now);
    expect(h.db.address.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: expect.objectContaining({ name: "Asha R", lastUsedAt: now }) });
    expect(h.db.address.create).not.toHaveBeenCalled();
  });

  it("adds a new address, making way by dropping the least recently used when full", async () => {
    const { rememberAddress } = await import("@/server/saved-addresses");
    const book = Array.from({ length: MAX_SAVED_ADDRESSES }, (_, i) => ({ id: `a${i}`, line1: `House ${i}`, line2: null, postalCode: "380015" }));
    h.db.address.findMany.mockResolvedValue(book); // oldest first, as the query orders them
    await rememberAddress("c1", ADDR);
    expect(h.db.address.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a0"] } } });
    expect(h.db.address.create).toHaveBeenCalledWith({ data: expect.objectContaining({ customerId: "c1", line1: "Flat 4, Shanti Nagar" }) });
  });
});

describe("saved boxes", () => {
  it("tidies the name, falling back to the box's own", () => {
    expect(cleanBoxName("  Monday   mix ", "Box of Gummies")).toBe("Monday mix");
    expect(cleanBoxName("", "Box of Gummies")).toBe("Box of Gummies");
  });

  it("reads only well-formed picks from storage", () => {
    expect(parsePicks([{ productId: "p1", quantity: 2 }, { productId: "", quantity: 1 }, { productId: "p2", quantity: 0 }, "junk", { productId: "p3", quantity: 1.5 }])).toEqual([{ productId: "p1", quantity: 2 }]);
    expect(parsePicks(null)).toEqual([]);
  });

  const BOX = {
    id: "b1",
    name: "Box of Gummies",
    size: 3,
    price: 999,
    maxPerProduct: 1,
    isActive: true,
    slots: [{ id: "s1", label: "Any", minPicks: 0, maxPicks: null }],
    products: ["p1", "p2", "p3"].map((productId) => ({ productId, slotId: "s1", excluded: false })),
  };

  it("saves only a complete box, and caps how many one shopper keeps", async () => {
    const { saveBoxForCustomer } = await import("@/server/saved-boxes");
    h.db.box.findUnique.mockResolvedValue(BOX);
    expect(await saveBoxForCustomer("c1", { boxId: "b1", name: "Mix", picks: [{ productId: "p1", quantity: 1 }] })).toMatchObject({ ok: false });
    const full = [{ productId: "p1", quantity: 1 }, { productId: "p2", quantity: 1 }, { productId: "p3", quantity: 1 }];
    expect(await saveBoxForCustomer("c1", { boxId: "b1", name: "Mix", picks: full })).toEqual({ ok: true, id: "sb1" });
    h.db.savedBox.count.mockResolvedValueOnce(10);
    expect(await saveBoxForCustomer("c1", { boxId: "b1", name: "Mix", picks: full })).toMatchObject({ ok: false });
  });

  it("keeps one copy when the same box is saved twice, in any order", async () => {
    const { saveBoxForCustomer } = await import("@/server/saved-boxes");
    h.db.box.findUnique.mockResolvedValue(BOX);
    h.db.savedBox.findMany.mockResolvedValueOnce([{ id: "old", picks: [{ productId: "p3", quantity: 1 }, { productId: "p1", quantity: 1 }, { productId: "p2", quantity: 1 }] }]);
    const full = [{ productId: "p1", quantity: 1 }, { productId: "p2", quantity: 1 }, { productId: "p3", quantity: 1 }];
    expect(await saveBoxForCustomer("c1", { boxId: "b1", name: "Again", picks: full })).toEqual({ ok: true, id: "old" });
    expect(h.db.savedBox.create).not.toHaveBeenCalled();
  });
});

const product = (id: string, units: number) => ({
  id,
  name: `Product ${id}`,
  slug: `product-${id}`,
  isActive: true,
  retailOnly: false,
  brand: { isActive: true },
  category: { isActive: true },
  regulatoryType: "PACKAGED_FOOD",
  shelfLifeDays: 180,
  stockQuantity: units,
  lowStockThreshold: 5,
  batches: units ? [{ id: `bt-${id}`, batchNumber: "B1", expiresOn: new Date("2030-01-01"), quantityRemaining: units }] : [],
});

describe("back-in-stock alerts", () => {
  it("keys each request by when it was asked, and lets old ones lapse", () => {
    const asked = new Date("2026-10-01T00:00:00Z");
    expect(stockAlertKey("al1", asked)).toBe(`back_in_stock:al1:${asked.getTime()}`);
    expect(alertLive(asked, new Date("2026-12-01T00:00:00Z"))).toBe(true);
    expect(alertLive(asked, new Date("2027-01-15T00:00:00Z"))).toBe(false);
  });

  it("queues alerts only for products that can ship again, and marks them done together", async () => {
    const { queueStockAlerts } = await import("@/server/stock-alerts");
    const asked = new Date("2026-10-01T00:00:00Z");
    h.db.stockAlert.findMany.mockResolvedValue([
      { id: "al1", productId: "back", createdAt: asked },
      { id: "al2", productId: "still-out", createdAt: asked },
    ]);
    h.db.product.findMany.mockResolvedValue([product("back", 12), product("still-out", 0)]);
    expect(await queueStockAlerts(new Date("2026-10-04T10:00:00Z"))).toEqual([`back_in_stock:al1:${asked.getTime()}`]);
    expect(h.db.stockAlert.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["al1"] }, notifiedAt: null }, data: { notifiedAt: new Date("2026-10-04T10:00:00Z") } });
    // The product page the email links to shows it in stock straight away.
    expect(h.expireTag).toHaveBeenCalledWith("catalog");
  });

  it("puts a request back to wait if the product sold out again before the email went", async () => {
    const { sendStockAlert } = await import("@/server/stock-alerts");
    const alert = { id: "al1", productId: "p1", email: "asha@shopper.in", createdAt: new Date("2026-10-01T00:00:00Z"), product: { id: "p1", name: "Ragi Chips", slug: "ragi-chips" } };
    h.db.stockAlert.findUnique.mockResolvedValue(alert);
    h.db.product.findMany.mockResolvedValueOnce([product("p1", 0)]);
    expect(await sendStockAlert({ alertId: "al1" }, new Date("2026-10-04T10:00:00Z"))).toEqual({ delivered: false, reason: "not_due" });
    expect(h.db.stockAlert.update).toHaveBeenCalledWith({ where: { id: "al1" }, data: { notifiedAt: null } });
    h.db.product.findMany.mockResolvedValueOnce([product("p1", 4)]);
    expect(await sendStockAlert({ alertId: "al1" }, new Date("2026-10-04T10:00:00Z"))).toEqual({ delivered: true });
    const mail = (h.emailsSend.mock.calls[0] as unknown as [{ subject: string; text: string }])[0];
    expect(mail.subject).toBe("Ragi Chips is back in stock");
    expect(mail.text).toContain("https://sooulone.in/product/ragi-chips");
  });

  it("doesn't take a request for something already in stock, and records consent when it does", async () => {
    const { requestStockAlert } = await import("@/server/stock-alerts");
    h.db.product.findUnique.mockResolvedValue(product("p1", 4));
    h.db.product.findMany.mockResolvedValueOnce([product("p1", 4)]);
    expect(await requestStockAlert("p1", "asha@shopper.in", null)).toMatchObject({ ok: false });
    h.db.product.findMany.mockResolvedValueOnce([product("p1", 0)]);
    expect(await requestStockAlert("p1", "asha@shopper.in", null)).toMatchObject({ ok: true });
    expect(h.db.consentRecord.create).toHaveBeenCalledWith({ data: expect.objectContaining({ purpose: "BACK_IN_STOCK", granted: true, email: "asha@shopper.in" }) });
  });
});
