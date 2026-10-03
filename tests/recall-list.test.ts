import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorityNoticeDraft, defaultBuyerNotice, groupOf, recipients, recipientsCsv } from "@/lib/recall";

/** The recall list and notices (src/lib/recall.ts, src/server/recall.ts). */

const h = vi.hoisted(() => ({
  db: {
    productBatch: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    order: { findUnique: vi.fn() },
    outboundMessage: { createMany: vi.fn(async () => ({ count: 0 })) },
  },
  processMessages: vi.fn(async () => []),
  emailsSend: vi.fn(async () => ({ error: null })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/server/business", () => ({ getBusinessProfile: async () => ({ customerCarePhone: "+91 79 4890 2200", customerCareEmail: "care@sooulone.in" }) }));
vi.mock("@/server/messages", async () => ({
  enqueueMessage: async (client: { outboundMessage: { createMany: (a: unknown) => Promise<{ count: number }> } }, ...m: unknown[]) =>
    (await client.outboundMessage.createMany({ data: m, skipDuplicates: true })).count,
  processMessages: h.processMessages,
}));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.emailsSend }; } }));

const order = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id,
  orderNumber: `SO-${id}`,
  placedAt: new Date(`2026-09-${10 + id.length}T06:00:00Z`),
  status,
  guestPhone: "9824011223",
  guestEmail: `${id}@shopper.in`,
  postalCode: "380015",
  shippingAddress: { name: "Asha Rao", city: "Ahmedabad" },
  customer: null,
  ...over,
});

const ITEMS = [
  { quantity: 2, order: order("a", "DELIVERED") },
  { quantity: 1, order: order("a", "DELIVERED") }, // the same order, second line
  { quantity: 1, order: order("bb", "PROCESSING") },
  { quantity: 1, order: order("ccc", "RTO") },
  { quantity: 3, order: order("dddd", "CANCELLED") }, // never left
  { quantity: 1, order: order("eeeee", "SHIPPED", { guestEmail: null }) },
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
});

describe("who received it", () => {
  it("groups orders by what to do, and leaves out orders whose goods never left", () => {
    expect([groupOf("PAID"), groupOf("SHIPPED"), groupOf("RETURNED"), groupOf("CANCELLED"), groupOf("PENDING_PAYMENT")]).toEqual(["hold", "customer", "returned", null, null]);
    const rows = recipients(ITEMS);
    expect(rows.map((r) => [r.orderNumber, r.group, r.quantity])).toEqual([
      ["SO-eeeee", "customer", 1],
      ["SO-ccc", "returned", 1],
      ["SO-bb", "hold", 1],
      ["SO-a", "customer", 3],
    ]);
    expect(rows.find((r) => r.orderNumber === "SO-a")).toMatchObject({ name: "Asha Rao", city: "Ahmedabad", pincode: "380015", phone: "9824011223" });
  });

  it("downloads as a spreadsheet Excel reads, where a name can never run as a formula", () => {
    const rows = recipients([{ quantity: 1, order: order("a", "DELIVERED", { shippingAddress: { name: '=HYPERLINK("x")', city: "Surat" } }) }]);
    const csv = recipientsCsv(rows, { product: "Biotin Glow Gummies", batchNumber: "G1" });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.split("\r\n")[1]).toContain('"With customers"');
  });
});

describe("the notices", () => {
  it("drafts the buyer notice with the reason", () => {
    expect(defaultBuyerNotice({ product: "Biotin Glow Gummies", batchNumber: "G1", reason: "A sealing fault" })).toMatch(/batch G1.*\nWhy: A sealing fault/);
  });

  it("drafts the authority notice from the figures", () => {
    const draft = authorityNoticeDraft({
      product: "Biotin Glow Gummies",
      batchNumber: "G1",
      manufacturedOn: new Date("2026-08-01"),
      expiresOn: new Date("2027-08-01"),
      manufacturer: "SooulOne Nutrition",
      manufacturerLicence: "10026011000417",
      seller: "SooulOne Consumer Brands Pvt Ltd",
      sellerLicence: "10726001000417",
      reason: "A sealing fault",
      received: 100,
      remaining: 60,
      rows: recipients(ITEMS),
    });
    expect(draft).toContain("Manufacturer: SooulOne Nutrition, FSSAI licence no. 10026011000417");
    expect(draft).toContain("Sold online and with customers: 4 units in 2 orders.");
    expect(draft).toContain("Sold but stopped before dispatch: 1 unit in 1 order.");
    expect(draft).toContain("Still in our stock and withdrawn from sale: 60 units.");
  });
});

describe("emailing the buyers", () => {
  const batch = (over: Record<string, unknown> = {}) => ({
    id: "b1",
    batchNumber: "G1",
    recalledAt: new Date(),
    recallNote: "A sealing fault",
    recallNoticeText: "Please stop using it.",
    product: { id: "p1", name: "Biotin Glow Gummies", manufacturer: null },
    supplier: null,
    orderItems: ITEMS,
    ...over,
  });

  it("refuses until the batch is recalled", async () => {
    h.db.productBatch.findUnique.mockResolvedValue(batch({ recalledAt: null }));
    const { sendRecallNotices } = await import("@/server/recall");
    expect(await sendRecallNotices("b1", "Please stop using it.")).toMatchObject({ ok: false });
    expect(h.db.outboundMessage.createMany).not.toHaveBeenCalled();
  });

  it("queues one email per buyer with the goods and an address, keyed so a second press sends nothing new", async () => {
    h.db.productBatch.findUnique.mockResolvedValue(batch());
    h.db.outboundMessage.createMany.mockResolvedValueOnce({ count: 1 });
    const { sendRecallNotices } = await import("@/server/recall");
    expect(await sendRecallNotices("b1", "Please stop using it.")).toEqual({ ok: true, queued: 1, call: 1 });
    expect(h.db.outboundMessage.createMany).toHaveBeenCalledWith({
      data: [{ kind: "recall_notice", dedupeKey: "recall_notice:b1:a", orderId: "a", payload: { batchId: "b1" } }],
      skipDuplicates: true,
    });
    expect(h.db.productBatch.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: expect.objectContaining({ recallNoticeText: "Please stop using it." }) });
    // Pressed again: the key already exists, so nothing is queued and the count says so.
    expect(await sendRecallNotices("b1", "Please stop using it.")).toEqual({ ok: true, queued: 0, call: 1 });
  });

  it("sends the owner's notice with the order number, and nothing once the recall is lifted", async () => {
    const { sendRecallNotice } = await import("@/server/recall");
    h.db.productBatch.findUnique.mockResolvedValue({ batchNumber: "G1", recalledAt: new Date(), recallNoticeText: "Please stop using it.", product: { name: "Biotin Glow Gummies" } });
    h.db.order.findUnique.mockResolvedValue({ orderNumber: "SO-a", guestEmail: "asha@shopper.in", customer: null });
    expect(await sendRecallNotice({ batchId: "b1" }, "a")).toEqual({ delivered: true });
    const mail = (h.emailsSend.mock.calls[0] as unknown as [{ subject: string; text: string }])[0];
    expect(mail.subject).toBe("Important: recall of Biotin Glow Gummies, batch G1");
    expect(mail.text).toContain("You bought this batch in order SO-a.");
    h.db.productBatch.findUnique.mockResolvedValue({ batchNumber: "G1", recalledAt: null, recallNoticeText: "x", product: { name: "Biotin Glow Gummies" } });
    expect(await sendRecallNotice({ batchId: "b1" }, "a")).toEqual({ delivered: false, reason: "not_due" });
  });
});
