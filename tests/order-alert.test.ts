import { beforeEach, describe, expect, it, vi } from "vitest";

/** M9: the owner hears about every real order, with no customer details in the email. */

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  emailsSend: vi.fn(async () => ({ error: null })),
  recordOrderEvent: vi.fn(),
  customerCareEmail: "care@sooulone.in" as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { order: { findUnique: h.findUnique } } }));
vi.mock("@/lib/order-events", () => ({ recordOrderEvent: h.recordOrderEvent }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/server/business", () => ({ getBusinessProfile: async () => ({ customerCareEmail: h.customerCareEmail }) }));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.emailsSend }; } }));

const ORDER = {
  orderNumber: "SO-MUK57TG0-XB",
  totalAmount: { toString: () => "1098.00" },
  paymentGateway: "COD",
  postalCode: "380015",
  riskScore: 72,
  items: [{ productNameSnapshot: "Biotin <Glow> Gummies", quantity: 2 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://sooulone.in";
  delete process.env.OWNER_ALERT_EMAIL;
  h.findUnique.mockResolvedValue(ORDER);
});

describe("new-order alert", () => {
  it("emails the owner the order, its total, method, pincode and risk band, with a console link", async () => {
    process.env.OWNER_ALERT_EMAIL = "owner@sooulone.in";
    const { alertOwnerNewOrder } = await import("@/server/order-alert");
    await alertOwnerNewOrder("o1");
    const mail = (h.emailsSend.mock.calls[0] as unknown as [{ to: string; subject: string; html: string; text: string }])[0];
    expect(mail.to).toBe("owner@sooulone.in");
    expect(mail.subject).toBe("New order SO-MUK57TG0-XB · ₹1,098.00 · Cash on delivery");
    expect(mail.html).toContain("Pincode 380015");
    expect(mail.html).toContain("RTO risk: high");
    expect(mail.html).toContain("https://sooulone.in/admin/orders/o1");
    expect(mail.html).toContain("Biotin &lt;Glow&gt; Gummies"); // escaped
    expect(h.recordOrderEvent).toHaveBeenCalledWith("o1", "EMAIL_SENT", { type: "SYSTEM" }, expect.objectContaining({ email: "owner_new_order", delivered: true }));
  });

  it("goes to customer care when no owner address is set (an empty value counts as unset)", async () => {
    process.env.OWNER_ALERT_EMAIL = "";
    const { alertOwnerNewOrder } = await import("@/server/order-alert");
    await alertOwnerNewOrder("o1");
    expect((h.emailsSend.mock.calls[0] as unknown as [{ to: string }])[0].to).toBe("care@sooulone.in");
  });

  it("never fails the order when the email or database fails", async () => {
    h.findUnique.mockRejectedValueOnce(new Error("down"));
    const { alertOwnerNewOrder } = await import("@/server/order-alert");
    await expect(alertOwnerNewOrder("o1")).resolves.toBeUndefined();
  });
});
