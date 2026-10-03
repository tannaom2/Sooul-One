import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS, messageKey, nextAttemptAt, outcomeOf, reasonLabel } from "@/lib/messages";

/** Benchmark gap M11: messages are written down first and retried until they go (src/server/messages.ts). */

const h = vi.hoisted(() => ({
  db: {
    $queryRaw: vi.fn(),
    outboundMessage: { createMany: vi.fn(async () => ({ count: 1 })), updateMany: vi.fn(async () => ({ count: 1 })), deleteMany: vi.fn(async () => ({ count: 0 })) },
  },
  recordOrderEvent: vi.fn(),
  senders: {
    order_confirmation: vi.fn(),
    shipping_notification: vi.fn(),
    owner_new_order: vi.fn(),
    enquiry_notice: vi.fn(),
    refill_reminder: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/order-events", () => ({ recordOrderEvent: h.recordOrderEvent }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/server/message-senders", () => ({ SENDERS: h.senders }));

const NOW = new Date("2026-10-05T10:00:00Z");
const claimed = (over: Record<string, unknown> = {}) => ({ id: "m1", kind: "order_confirmation", dedupeKey: "order_confirmation:o1", payload: {}, orderId: "o1", attempts: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

describe("the retry rules", () => {
  it("waits longer after each failure, then gives up", () => {
    const mins = (n: number) => (nextAttemptAt(n, NOW)!.getTime() - NOW.getTime()) / 60_000;
    expect([1, 2, 3, 4, 5].map(mins)).toEqual([1, 5, 30, 120, 720]);
    expect(nextAttemptAt(MAX_ATTEMPTS, NOW)).toBeNull();
  });

  it("never retries what can't change: no address, a test address, email not set up, gone", () => {
    for (const reason of ["no_recipient", "test_address", "not_configured", "not_found", "opted_out"]) {
      expect(outcomeOf({ delivered: false, reason }, 1, NOW)).toEqual({ status: "SKIPPED", reason });
    }
  });

  it("retries a provider failure, and fails it after the last try", () => {
    expect(outcomeOf({ delivered: false, reason: "exception" }, 1, NOW)).toMatchObject({ status: "PENDING", retryAt: new Date(NOW.getTime() + 60_000) });
    expect(outcomeOf({ delivered: false, reason: "exception" }, MAX_ATTEMPTS, NOW)).toEqual({ status: "FAILED", reason: "exception" });
    expect(outcomeOf({ delivered: true }, 3, NOW)).toEqual({ status: "SENT" });
  });

  it("says what went wrong in plain words", () => {
    expect(reasonLabel("not_configured")).toBe("Email isn't set up on this server");
    expect(reasonLabel("exception: socket hang up")).toBe("Something went wrong sending it (socket hang up)");
  });
});

describe("the queue", () => {
  it("writes messages down once per key, inside the caller's transaction if given", async () => {
    const { enqueueMessage } = await import("@/server/messages");
    const tx = { outboundMessage: { createMany: vi.fn(async () => ({ count: 1 })) } };
    await enqueueMessage(tx as never, { kind: "order_confirmation", dedupeKey: messageKey.orderConfirmation("o1"), orderId: "o1" });
    expect(tx.outboundMessage.createMany).toHaveBeenCalledWith({
      data: [{ kind: "order_confirmation", dedupeKey: "order_confirmation:o1", orderId: "o1", payload: {} }],
      skipDuplicates: true,
    });
  });

  it("marks a sent message sent and puts it on the order's timeline", async () => {
    h.db.$queryRaw.mockResolvedValue([claimed()]);
    h.senders.order_confirmation.mockResolvedValue({ delivered: true });
    const { processMessages } = await import("@/server/messages");
    expect((await processMessages())[0].outcome).toEqual({ status: "SENT" });
    expect(h.db.outboundMessage.updateMany).toHaveBeenCalledWith({ where: { id: "m1", status: "SENDING" }, data: expect.objectContaining({ status: "SENT", sentAt: NOW }) });
    expect(h.recordOrderEvent).toHaveBeenCalledWith("o1", "EMAIL_SENT", { type: "SYSTEM" }, { email: "order_confirmation", delivered: true, reason: null });
  });

  it("schedules a retry when sending throws, without telling the timeline yet", async () => {
    h.db.$queryRaw.mockResolvedValue([claimed()]);
    h.senders.order_confirmation.mockRejectedValue(new Error("socket hang up"));
    const { processMessages } = await import("@/server/messages");
    expect((await processMessages())[0].outcome.status).toBe("PENDING");
    expect(h.db.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", status: "SENDING" },
      data: { status: "PENDING", sendAfter: new Date(NOW.getTime() + 60_000), lockedUntil: null, lastError: "exception: socket hang up" },
    });
    expect(h.recordOrderEvent).not.toHaveBeenCalled();
  });

  it("gives up after the last try, and the timeline says so with the count", async () => {
    h.db.$queryRaw.mockResolvedValue([claimed({ attempts: MAX_ATTEMPTS })]);
    h.senders.order_confirmation.mockResolvedValue({ delivered: false, reason: "rate limited" });
    const { processMessages } = await import("@/server/messages");
    expect((await processMessages())[0].outcome).toEqual({ status: "FAILED", reason: "rate limited" });
    expect(h.recordOrderEvent).toHaveBeenCalledWith("o1", "EMAIL_SENT", { type: "SYSTEM" }, { email: "order_confirmation", delivered: false, reason: "rate limited", attempts: MAX_ATTEMPTS });
  });

  it("skips a message with nothing to send to, and passes the payload to its sender", async () => {
    h.db.$queryRaw.mockResolvedValue([claimed({ kind: "enquiry_notice", orderId: null, payload: { enquiryId: "e1" } })]);
    h.senders.enquiry_notice.mockResolvedValue({ delivered: false, reason: "not_configured" });
    const { processMessages } = await import("@/server/messages");
    expect((await processMessages())[0].outcome).toEqual({ status: "SKIPPED", reason: "not_configured" });
    expect(h.senders.enquiry_notice).toHaveBeenCalledWith({ enquiryId: "e1" }, null);
    expect(h.recordOrderEvent).not.toHaveBeenCalled(); // not about an order
  });

  it("never throws: a database error claiming messages sends nothing this round", async () => {
    h.db.$queryRaw.mockRejectedValue(new Error("down"));
    const { processMessages, deliverNow } = await import("@/server/messages");
    await expect(processMessages()).resolves.toEqual([]);
    h.db.outboundMessage.createMany.mockRejectedValueOnce(new Error("down"));
    await expect(deliverNow({ kind: "owner_new_order", dedupeKey: "owner_new_order:o1", orderId: "o1" })).resolves.toEqual([]);
  });
});
