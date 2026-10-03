import { beforeEach, describe, expect, it, vi } from "vitest";
import { daysOfSupply, isStale, refillableLines, reminderDate, runOutDate, type RefillLine } from "@/lib/refill";

/** Benchmark gap R2: refill reminders, only for shoppers who asked (src/server/refill-reminders.ts). */

const h = vi.hoisted(() => ({
  db: {
    order: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(async (_args?: unknown) => 0) },
    outboundMessage: { createMany: vi.fn(async () => ({ count: 0 })) },
  },
  emailsSend: vi.fn(async () => ({ error: null })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.emailsSend }; } }));
vi.mock("@/server/message-senders", () => ({ SENDERS: {} }));

const DAY = 86_400_000;
const DELIVERED = new Date("2026-10-01T06:00:00Z");
const line = (over: Partial<RefillLine> = {}): RefillLine => ({ productId: "p1", name: "Biotin Glow Gummies", quantity: 1, servingsPerContainer: 30, servingsPerDay: 1, ...over });
const item = (over: Record<string, unknown> = {}) => ({
  productId: "p1",
  productNameSnapshot: "Biotin Glow Gummies",
  quantity: 1,
  product: { servingsPerContainer: 30, servingsPerDay: 1, regulatoryType: "HEALTH_SUPPLEMENT" },
  ...over,
});
const ORDER = {
  id: "o1",
  orderNumber: "SO-1",
  accessToken: "tok",
  status: "DELIVERED",
  placedAt: new Date("2026-09-27T06:00:00Z"),
  deliveredAt: DELIVERED,
  refillOptInAt: new Date("2026-09-27T06:05:00Z"),
  guestEmail: "asha@sooulone-shopper.in",
  guestPhone: "9824011223",
  customerId: null,
  customer: null,
  items: [item(), item({ productId: "p2", productNameSnapshot: "Masala Makhana", product: { servingsPerContainer: null, servingsPerDay: null, regulatoryType: "PACKAGED_FOOD" } })],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://sooulone.in";
  h.db.order.findUnique.mockResolvedValue(ORDER);
  h.db.order.count.mockResolvedValue(0);
});

describe("when an order runs out", () => {
  it("counts a pack's servings at the daily dose, across the quantity bought", () => {
    expect(daysOfSupply(line())).toBe(30);
    expect(daysOfSupply(line({ servingsPerDay: 2 }))).toBe(15);
    expect(daysOfSupply(line({ quantity: 3, servingsPerDay: 2 }))).toBe(45);
    expect(daysOfSupply(line({ servingsPerDay: null }))).toBeNull(); // no daily dose set: not offered
  });

  it("runs out when its first product does, and reminds five days before", () => {
    const lines = [line({ quantity: 2 }), line({ productId: "p2", name: "Kids Multivitamin", servingsPerDay: 2 })];
    expect(runOutDate(lines, DELIVERED)).toEqual(new Date(DELIVERED.getTime() + 15 * DAY));
    expect(reminderDate(lines, DELIVERED)).toEqual(new Date(DELIVERED.getTime() + 10 * DAY));
  });

  it("adds up a product split across lines, and leaves out what can't be counted", () => {
    expect(refillableLines([line(), line(), line({ productId: "food", servingsPerContainer: null })])).toEqual([line({ quantity: 2 })]);
  });

  it("never reminds before delivery, and calls a reminder ten days past run-out stale", () => {
    expect(reminderDate([line({ servingsPerContainer: 3 })], DELIVERED)).toEqual(DELIVERED);
    expect(isStale([line()], DELIVERED, new Date(DELIVERED.getTime() + 39 * DAY))).toBe(false);
    expect(isStale([line()], DELIVERED, new Date(DELIVERED.getTime() + 41 * DAY))).toBe(true);
  });
});

describe("queueing", () => {
  it("queues one reminder per delivered order whose date has come, and only those", async () => {
    h.db.order.findMany.mockResolvedValue([
      { id: "due", deliveredAt: DELIVERED, items: [item()] },
      { id: "later", deliveredAt: new Date(DELIVERED.getTime() + 20 * DAY), items: [item()] },
      { id: "food-only", deliveredAt: DELIVERED, items: [item({ product: { servingsPerContainer: null, servingsPerDay: null, regulatoryType: "PACKAGED_FOOD" } })] },
    ]);
    const { queueRefillReminders } = await import("@/server/refill-reminders");
    expect(await queueRefillReminders(new Date(DELIVERED.getTime() + 26 * DAY))).toBe(1);
    expect(h.db.outboundMessage.createMany).toHaveBeenCalledWith({
      data: [{ kind: "refill_reminder", dedupeKey: "refill_reminder:due", orderId: "due", payload: {} }],
      skipDuplicates: true,
    });
    // Only orders that asked, were delivered, and haven't had one.
    expect(h.db.order.findMany.mock.calls[0][0].where).toMatchObject({ refillOptInAt: { not: null }, status: "DELIVERED", messages: { none: { kind: "refill_reminder" } } });
  });
});

describe("sending", () => {
  const at = new Date(DELIVERED.getTime() + 25 * DAY);

  it("emails what's running low and when, with the order link and a stop link", async () => {
    const { sendRefillReminder } = await import("@/server/refill-reminders");
    expect(await sendRefillReminder({}, "o1", at)).toEqual({ delivered: true });
    const mail = (h.emailsSend.mock.calls[0] as unknown as [{ to: string; subject: string; html: string; text: string }])[0];
    expect(mail.to).toBe("asha@sooulone-shopper.in");
    expect(mail.subject).toBe("Biotin Glow Gummies runs out around 31 Oct");
    expect(mail.text).not.toContain("Masala Makhana"); // only what runs out
    expect(mail.html).toContain("https://sooulone.in/order/SO-1?t=tok");
    expect(mail.html).toContain("https://sooulone.in/reminders/stop?o=SO-1&amp;t=tok");
  });

  it("doesn't send once the shopper stopped them, before delivery, or long after run-out", async () => {
    const { sendRefillReminder } = await import("@/server/refill-reminders");
    h.db.order.findUnique.mockResolvedValueOnce({ ...ORDER, refillOptInAt: null });
    expect(await sendRefillReminder({}, "o1", at)).toEqual({ delivered: false, reason: "opted_out" });
    h.db.order.findUnique.mockResolvedValueOnce({ ...ORDER, status: "SHIPPED", deliveredAt: null });
    expect(await sendRefillReminder({}, "o1", at)).toEqual({ delivered: false, reason: "not_due" });
    expect(await sendRefillReminder({}, "o1", new Date(DELIVERED.getTime() + 60 * DAY))).toEqual({ delivered: false, reason: "not_due" });
    expect(h.emailsSend).not.toHaveBeenCalled();
  });

  it("doesn't nag someone who already ordered it again", async () => {
    h.db.order.count.mockResolvedValue(1);
    const { sendRefillReminder } = await import("@/server/refill-reminders");
    expect(await sendRefillReminder({}, "o1", at)).toEqual({ delivered: false, reason: "reordered" });
    expect((h.db.order.count.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toMatchObject({ id: { not: "o1" }, OR: [{ guestPhone: "9824011223" }], items: { some: { productId: { in: ["p1"] } } } });
  });

  it("has nothing to send to without an email", async () => {
    h.db.order.findUnique.mockResolvedValueOnce({ ...ORDER, guestEmail: null });
    const { sendRefillReminder } = await import("@/server/refill-reminders");
    expect(await sendRefillReminder({}, "o1", at)).toEqual({ delivered: false, reason: "no_recipient" });
  });
});
