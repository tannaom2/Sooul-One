import { describe, expect, it } from "vitest";
import { orderProgress } from "../src/lib/order-progress";

const placedAt = "2026-09-25T10:00:00Z";
const changed = (to: string, at: string, extra: object = {}) => ({
  type: "STATUS_CHANGED",
  createdAt: at,
  detail: { status: { from: "X", to }, ...extra },
});
const doneKeys = (p: ReturnType<typeof orderProgress>) => p.stages.filter((s) => s.done).map((s) => s.key);
const current = (p: ReturnType<typeof orderProgress>) => p.stages.find((s) => s.current)?.key;

describe("orderProgress", () => {
  it("an online order waiting for payment is placed, not yet packing", () => {
    const p = orderProgress({ status: "PENDING_PAYMENT", placedAt }, [{ type: "PLACED", createdAt: placedAt }]);
    expect(doneKeys(p)).toEqual(["placed"]);
    expect(current(p)).toBe("placed");
  });

  it("a COD order is packing from the moment it's placed", () => {
    const p = orderProgress({ status: "PROCESSING", placedAt }, [{ type: "PLACED", createdAt: placedAt }]);
    expect(current(p)).toBe("packing");
    expect(p.stages[1].date).toEqual(new Date(placedAt));
  });

  it("dates each stage from the history and shows tracking once shipped", () => {
    const p = orderProgress({ status: "SHIPPED", placedAt, trackingNumber: "DL123", courierPartner: "Delhivery" }, [
      { type: "PLACED", createdAt: placedAt },
      { type: "PAYMENT_CAPTURED", createdAt: "2026-09-25T10:05:00Z" },
      changed("SHIPPED", "2026-09-26T09:00:00Z", { trackingNumber: { from: null, to: "DL123" } }),
    ]);
    expect(doneKeys(p)).toEqual(["placed", "packing", "shipped"]);
    expect(p.stages[1].date).toEqual(new Date("2026-09-25T10:05:00Z"));
    expect(p.stages[2].date).toEqual(new Date("2026-09-26T09:00:00Z"));
    expect(p.tracking).toEqual({ number: "DL123", courier: "Delhivery" });
  });

  it("doesn't show a tracking number before the order has shipped", () => {
    const p = orderProgress({ status: "PROCESSING", placedAt, trackingNumber: "DL123" }, []);
    expect(p.tracking).toBeNull();
  });

  it("a cancelled order shows how far it got and when it ended, with no current stage", () => {
    const p = orderProgress({ status: "CANCELLED", placedAt }, [
      { type: "PLACED", createdAt: placedAt },
      changed("PROCESSING", "2026-09-25T11:00:00Z"),
      changed("CANCELLED", "2026-09-25T12:00:00Z"),
    ]);
    expect(doneKeys(p)).toEqual(["placed", "packing"]);
    expect(current(p)).toBeUndefined();
    expect(p.ended).toEqual({ label: "Cancelled", date: new Date("2026-09-25T12:00:00Z") });
  });

  it("never reads staff notes or email records", () => {
    const p = orderProgress({ status: "PROCESSING", placedAt }, [
      { type: "NOTE", createdAt: placedAt, detail: { note: "customer rang, very rude" } },
      { type: "EMAIL_SENT", createdAt: placedAt, detail: { email: "order_confirmation" } },
    ]);
    expect(JSON.stringify(p)).not.toMatch(/rude|order_confirmation/);
  });
});
