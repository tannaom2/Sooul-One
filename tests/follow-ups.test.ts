import { beforeEach, describe, expect, it, vi } from "vitest";
import { followUpKey, howToTake, morningIST, reviewableItems, suggestedReviewName } from "@/lib/follow-ups";

/** The emails after an order and reviews from the order page (src/lib/follow-ups.ts, src/server/follow-ups.ts). */

const h = vi.hoisted(() => ({
  db: {
    order: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    review: { findMany: vi.fn(async () => [] as { productId: string }[]), create: vi.fn(async () => ({})) },
    consentRecord: { findFirst: vi.fn(async () => null as { granted: boolean } | null), create: vi.fn((a: unknown) => a) },
    outboundMessage: { updateMany: vi.fn((a: unknown) => a) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
  emailsSend: vi.fn(async () => ({ error: null })),
  refill: vi.fn(async () => ({ offer: false, optedIn: false, remindOn: null, hasEmail: true })),
  ownOrder: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/server/refill-reminders", () => ({ refillStatus: h.refill }));
vi.mock("@/server/order-owner", () => ({ ownOrder: h.ownOrder }));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.emailsSend }; } }));

const GUMMY = { productId: "g1", productNameSnapshot: "Biotin Glow Gummies", product: { regulatoryType: "HEALTH_SUPPLEMENT", dosageGuidance: "Chew 2 gummies a day after a meal." } };
const CHIPS = { productId: "s1", productNameSnapshot: "Ragi Chips", product: { regulatoryType: "PACKAGED_FOOD", dosageGuidance: null } };

const order = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  orderNumber: "SO-1",
  accessToken: "tok",
  status: "DELIVERED",
  guestEmail: "asha@shopper.in",
  guestPhone: "9824011223",
  customer: null,
  items: [GUMMY, CHIPS, { ...GUMMY }],
  ...over,
});

const mail = () => (h.emailsSend.mock.calls[0] as unknown as [{ to: string; subject: string; text: string }])[0];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://sooulone.in";
});

describe("timing and keys", () => {
  it("schedules follow-ups for 10 am India time on the right India-time day", () => {
    // 01:30 IST on 5 Oct: a week later is 12 Oct, 10:00 IST.
    expect(morningIST(new Date("2026-10-04T20:00:00Z"), 7).toISOString()).toBe("2026-10-12T04:30:00.000Z");
    // 15:30 IST on 4 Oct.
    expect(morningIST(new Date("2026-10-04T10:00:00Z"), 14).toISOString()).toBe("2026-10-18T04:30:00.000Z");
  });

  it("keys refunds per refund, so a second partial refund gets its own email", () => {
    expect(followUpKey.refund("o1", "rfnd_1")).not.toBe(followUpKey.refund("o1", "rfnd_2"));
    expect(followUpKey.refund("o1", null)).toBe("refund_notice:o1:order");
  });

  it("queues the arrival email now and the check-in and review request for later", async () => {
    const { followUpsOnDelivery } = await import("@/server/follow-ups");
    const msgs = followUpsOnDelivery("o1", new Date("2026-10-04T10:00:00Z"));
    expect(msgs.map((m) => [m.kind, m.sendAfter?.toISOString() ?? null])).toEqual([
      ["delivered_notice", null],
      ["check_in", "2026-10-11T04:30:00.000Z"],
      ["review_request", "2026-10-18T04:30:00.000Z"],
    ]);
  });
});

describe("what the emails say", () => {
  it("lists each product once, leaving out the ones already reviewed", () => {
    expect(reviewableItems(order().items, []).map((i) => i.productId)).toEqual(["g1", "s1"]);
    expect(reviewableItems(order().items, ["g1"]).map((i) => i.productId)).toEqual(["s1"]);
  });

  it("gives how-to-take only for supplements, in the label's words", () => {
    expect(howToTake(order().items)).toEqual([{ name: "Biotin Glow Gummies", guidance: "Chew 2 gummies a day after a meal." }]);
  });

  it("suggests a first name and last initial, never the full name", () => {
    expect([suggestedReviewName("Asha Rao"), suggestedReviewName("Kunal Vinod bhatt"), suggestedReviewName("Pooja"), suggestedReviewName(null)]).toEqual(["Asha R.", "Kunal B.", "Pooja", ""]);
  });
});

describe("sending", () => {
  it("sends the arrival email with how to take it, and nothing once the parcel came back", async () => {
    const { sendDeliveredNotice } = await import("@/server/follow-ups");
    h.db.order.findUnique.mockResolvedValueOnce(order());
    expect(await sendDeliveredNotice("o1")).toEqual({ delivered: true });
    expect(mail().text).toContain("Biotin Glow Gummies: Chew 2 gummies a day after a meal.");
    h.db.order.findUnique.mockResolvedValueOnce(order({ status: "RETURNED" }));
    expect(await sendDeliveredNotice("o1")).toEqual({ delivered: false, reason: "not_due" });
  });

  it("holds the check-in for a shopper who said stop", async () => {
    const { sendCheckIn } = await import("@/server/follow-ups");
    h.db.order.findUnique.mockResolvedValue(order());
    h.db.consentRecord.findFirst.mockResolvedValueOnce({ granted: false });
    expect(await sendCheckIn("o1")).toEqual({ delivered: false, reason: "opted_out" });
    expect(h.emailsSend).not.toHaveBeenCalled();
    expect(await sendCheckIn("o1")).toEqual({ delivered: true });
    expect(mail().text).toContain("Stop these emails: https://sooulone.in/reminders/stop?k=follow-ups&o=SO-1&t=tok");
  });

  it("asks for reviews only of products not yet reviewed, linking to the order page form", async () => {
    const { sendReviewRequest } = await import("@/server/follow-ups");
    h.db.order.findUnique.mockResolvedValue(order());
    h.db.review.findMany.mockResolvedValueOnce([{ productId: "g1" }]);
    expect(await sendReviewRequest("o1")).toEqual({ delivered: true });
    expect(mail().text).toContain("  - Ragi Chips");
    expect(mail().text).not.toContain("Biotin");
    expect(mail().text).toContain("https://sooulone.in/order/SO-1?t=tok#review");
    h.db.review.findMany.mockResolvedValueOnce([{ productId: "g1" }, { productId: "s1" }]);
    expect(await sendReviewRequest("o1")).toEqual({ delivered: false, reason: "not_due" });
  });

  it("states the refund amount in rupees", async () => {
    const { sendRefundNotice } = await import("@/server/follow-ups");
    h.db.order.findUnique.mockResolvedValue(order({ status: "REFUNDED" }));
    expect(await sendRefundNotice({ amountPaise: 123450 }, "o1")).toEqual({ delivered: true });
    expect(mail().text).toContain("A refund of ₹1,234.50 for order SO-1 has been processed.");
  });

  it("stopping records the choice and cancels scheduled follow-ups for the same shopper", async () => {
    const { stopFollowUps } = await import("@/server/follow-ups");
    h.db.order.findUniqueOrThrow.mockResolvedValue(order());
    await stopFollowUps("o1");
    expect(h.db.outboundMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ kind: { in: ["check_in", "review_request"] }, status: "PENDING" }), data: { status: "CANCELLED" } }),
    );
    expect(h.db.consentRecord.create).toHaveBeenCalledWith({ data: expect.objectContaining({ purpose: "ORDER_FOLLOW_UP", granted: false, email: "asha@shopper.in" }) });
  });
});

describe("reviews from the order page", () => {
  const input = { productId: "g1", customerName: "Asha R.", rating: 4, comment: "Tastes fine, easy to take." };

  it("saves a review carrying the order, so it shows as from a verified buyer", async () => {
    const { submitOrderReview } = await import("@/app/order/[orderNumber]/review-actions");
    h.ownOrder.mockResolvedValue({ id: "o1" });
    h.db.order.findUnique.mockResolvedValue(order());
    expect((await submitOrderReview("SO-1", "tok", input)).ok).toBe(true);
    expect(h.db.review.create).toHaveBeenCalledWith({ data: { orderId: "o1", productId: "g1", customerName: "Asha R.", rating: 4, comment: "Tastes fine, easy to take.", isApproved: false } });
  });

  it("refuses someone else's order, an order not delivered, or a product not in it", async () => {
    const { submitOrderReview } = await import("@/app/order/[orderNumber]/review-actions");
    h.ownOrder.mockResolvedValueOnce(null);
    expect((await submitOrderReview("SO-1", "wrong", input)).ok).toBe(false);
    h.ownOrder.mockResolvedValue({ id: "o1" });
    h.db.order.findUnique.mockResolvedValueOnce(order({ status: "SHIPPED" }));
    expect(await submitOrderReview("SO-1", "tok", input)).toMatchObject({ ok: false, message: "You can review once your order has been delivered." });
    h.db.order.findUnique.mockResolvedValueOnce(order());
    expect(await submitOrderReview("SO-1", "tok", { ...input, productId: "zz" })).toMatchObject({ ok: false, message: "That product isn't in this order." });
    expect(h.db.review.create).not.toHaveBeenCalled();
  });

  it("allows one review per product per order", async () => {
    const { submitOrderReview } = await import("@/app/order/[orderNumber]/review-actions");
    h.ownOrder.mockResolvedValue({ id: "o1" });
    h.db.order.findUnique.mockResolvedValue(order());
    h.db.review.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await submitOrderReview("SO-1", "tok", input)).toMatchObject({ ok: false, message: "You've already reviewed this product from this order." });
  });
});
