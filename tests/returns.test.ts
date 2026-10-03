import { beforeEach, describe, expect, it, vi } from "vitest";
import { decisionSummary, isFinal, restockProblem } from "@/lib/returns";

/** Checking a parcel that came back (src/lib/returns.ts, orders/[id]/return-actions.ts). */

const h = vi.hoisted(() => {
  const tx = {
    returnCheck: { create: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    productBatch: { update: vi.fn(async () => ({})) },
  };
  return {
    tx,
    db: { order: { findUnique: vi.fn() }, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) },
    recordOrderEvent: vi.fn(),
    audit: vi.fn(),
    refreshTag: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/auth", () => ({ requirePermission: async () => ({ email: "pack@sooulone.in", role: "FULFILMENT", adminUserId: "a1" }), audit: h.audit }));
vi.mock("@/lib/order-events", () => ({ recordOrderEvent: h.recordOrderEvent }));
vi.mock("@/lib/cache-tags", () => ({ CATALOG_TAG: "catalog", refreshTag: h.refreshTag }));

const DAY = 86_400_000;
const NOW = new Date("2026-10-04T06:00:00Z");
const good = { recalledAt: null, expiresOn: new Date(NOW.getTime() + 300 * DAY) };

const line = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  quantity: 2,
  productNameSnapshot: "Masala Makhana",
  returnCheck: null,
  batch: { id: `b-${id}`, ...good },
  product: { shelfLifeDays: 180 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.tx.returnCheck.updateMany.mockResolvedValue({ count: 1 });
});

describe("the rules", () => {
  it("never puts back a recalled batch, one without a batch, or one too close to its best-before to ship", () => {
    expect(restockProblem(good, 180, NOW)).toBeNull();
    expect(restockProblem({ ...good, recalledAt: NOW }, 180, NOW)).toMatch(/recalled/);
    expect(restockProblem(null, 180, NOW)).toMatch(/No batch/);
    expect(restockProblem({ recalledAt: null, expiresOn: new Date(NOW.getTime() + 20 * DAY) }, 180, NOW)).toMatch(/Too close/);
  });

  it("treats back-to-stock and write-off as final, and set-aside as still open", () => {
    expect([isFinal("RESTOCKED"), isFinal("WRITTEN_OFF"), isFinal("QUARANTINED"), isFinal(null)]).toEqual([true, true, false, false]);
    expect(decisionSummary([{ outcome: "RESTOCKED", quantity: 2 }, { outcome: "WRITTEN_OFF", quantity: 1 }])).toBe("2 back to stock, 1 written off");
  });
});

describe("saving the check", () => {
  it("adds back-to-stock units to their batch in the same step, and notes it on the order", async () => {
    h.db.order.findUnique.mockResolvedValue({ orderNumber: "SO-1", status: "RTO", items: [line("i1"), line("i2")] });
    const { checkReturnedParcel } = await import("@/app/admin/(console)/orders/[id]/return-actions");
    const result = await checkReturnedParcel("o1", [
      { orderItemId: "i1", outcome: "RESTOCKED" },
      { orderItemId: "i2", outcome: "WRITTEN_OFF", note: "seal broken" },
    ]);
    expect(result).toEqual({ ok: true, message: "Recorded: 2 back to stock, 2 written off." });
    expect(h.tx.productBatch.update).toHaveBeenCalledTimes(1);
    expect(h.tx.productBatch.update).toHaveBeenCalledWith({ where: { id: "b-i1" }, data: { quantityRemaining: { increment: 2 } } });
    expect(h.recordOrderEvent).toHaveBeenCalledWith("o1", "NOTE", { type: "ADMIN", email: "pack@sooulone.in" }, { note: "Returned parcel checked: 2 back to stock, 2 written off." });
    expect(h.refreshTag).toHaveBeenCalledWith("catalog");
  });

  it("refuses to restock a recalled batch, and changes nothing", async () => {
    h.db.order.findUnique.mockResolvedValue({ orderNumber: "SO-1", status: "RETURNED", items: [line("i1", { batch: { id: "b1", ...good, recalledAt: NOW } })] });
    const { checkReturnedParcel } = await import("@/app/admin/(console)/orders/[id]/return-actions");
    const result = await checkReturnedParcel("o1", [{ orderItemId: "i1", outcome: "RESTOCKED" }]);
    expect(result.ok).toBe(false);
    expect(result.lineErrors?.i1).toMatch(/recalled/);
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("leaves final decisions alone, and only checks parcels that came back", async () => {
    const { checkReturnedParcel } = await import("@/app/admin/(console)/orders/[id]/return-actions");
    h.db.order.findUnique.mockResolvedValueOnce({ orderNumber: "SO-1", status: "RTO", items: [line("i1", { returnCheck: { outcome: "WRITTEN_OFF" } })] });
    expect(await checkReturnedParcel("o1", [{ orderItemId: "i1", outcome: "RESTOCKED" }])).toEqual({ ok: true, message: "Nothing new to record." });
    h.db.order.findUnique.mockResolvedValueOnce({ orderNumber: "SO-1", status: "DELIVERED", items: [line("i1")] });
    expect((await checkReturnedParcel("o1", [{ orderItemId: "i1", outcome: "RESTOCKED" }])).ok).toBe(false);
    expect(h.tx.productBatch.update).not.toHaveBeenCalled();
  });

  it("moves a set-aside line on only if nobody else decided it meanwhile, so stock is never added twice", async () => {
    h.db.order.findUnique.mockResolvedValue({ orderNumber: "SO-1", status: "RTO", items: [line("i1", { returnCheck: { outcome: "QUARANTINED" } })] });
    h.tx.returnCheck.updateMany.mockResolvedValueOnce({ count: 0 });
    h.db.$transaction.mockImplementationOnce(async (fn: (t: typeof h.tx) => unknown) => fn(h.tx));
    const { checkReturnedParcel } = await import("@/app/admin/(console)/orders/[id]/return-actions");
    const result = await checkReturnedParcel("o1", [{ orderItemId: "i1", outcome: "RESTOCKED" }]);
    expect(result.ok).toBe(false);
    expect(h.tx.returnCheck.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orderItemId: "i1", outcome: "QUARANTINED" } }));
    expect(h.recordOrderEvent).not.toHaveBeenCalled();
  });
});
