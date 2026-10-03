import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanLicence, licenceLabel, licenceReminderKey, licenceReminders, licenceStatus, liveLicenceProblem, supplierSchema } from "@/lib/suppliers";

/** Suppliers and their FSSAI licences (src/lib/suppliers.ts, src/server/suppliers.ts). */

const h = vi.hoisted(() => ({
  db: {
    product: { count: vi.fn(async () => 0) },
    supplier: { create: vi.fn(async () => ({ id: "s1" })), update: vi.fn(async () => ({ id: "s1" })), findUnique: vi.fn() },
    outboundMessage: { updateMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
  },
  emailsSend: vi.fn(async () => ({ error: null })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/server/business", () => ({ getBusinessProfile: async () => ({ customerCareEmail: "care@sooulone.in" }) }));
vi.mock("@/server/message-senders", () => ({ SENDERS: {} }));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.emailsSend }; } }));

const DAY = 86_400_000;
const NOW = new Date("2026-10-04T06:00:00Z");
const valid = {
  name: "Gujarat Gummies Pvt Ltd",
  address: "Plot 12, GIDC Sanand, Ahmedabad 382110",
  fssaiLicence: "1002 6011 0004 17",
  licenceType: "CENTRAL",
  licenceExpiresOn: new Date("2027-06-30T00:00:00+05:30"),
  gstin: "24aakcs4821m1zx",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  notes: "",
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  delete process.env.OWNER_ALERT_EMAIL;
});

describe("the record", () => {
  it("takes a licence number typed with spaces or dashes, and a lower-case GSTIN", () => {
    expect(cleanLicence("1002-6011-0004-17")).toBe("10026011000417");
    const parsed = supplierSchema.parse(valid);
    expect(parsed.fssaiLicence).toBe("10026011000417");
    expect(parsed.gstin).toBe("24AAKCS4821M1ZX");
    expect(parsed.contactEmail).toBeNull();
  });

  it("refuses a licence number that isn't 14 digits, and a licence with no expiry or kind", () => {
    const issues = (over: object) => supplierSchema.safeParse({ ...valid, ...over }).error?.issues.map((i) => i.path[0]);
    expect(issues({ fssaiLicence: "12345" })).toContain("fssaiLicence");
    expect(issues({ licenceExpiresOn: null })).toContain("licenceExpiresOn");
    expect(issues({ licenceType: null })).toContain("licenceType");
    // A basic registration needn't carry an expiry; no licence at all is allowed while a product is a draft.
    expect(supplierSchema.safeParse({ ...valid, licenceType: "REGISTRATION", licenceExpiresOn: null }).success).toBe(true);
    expect(supplierSchema.safeParse({ ...valid, fssaiLicence: "", licenceType: null, licenceExpiresOn: null }).success).toBe(true);
  });
});

describe("licence status", () => {
  const at = (days: number) => ({ fssaiLicence: "10026011000417", licenceExpiresOn: new Date(NOW.getTime() + days * DAY) });

  it("is missing, expired, expiring within 60 days, or valid", () => {
    expect(licenceStatus({ fssaiLicence: null, licenceExpiresOn: null }, NOW)).toEqual({ state: "missing" });
    expect(licenceStatus(at(-3), NOW)).toEqual({ state: "expired", days: 3 });
    expect(licenceStatus(at(30), NOW)).toEqual({ state: "expiring", days: 30 });
    expect(licenceStatus(at(200), NOW)).toEqual({ state: "valid", days: 200 });
    expect(licenceLabel(licenceStatus(at(1), NOW))).toBe("Licence expires in 1 day");
  });
});

describe("expiry reminders", () => {
  it("go 60 and 14 days before", () => {
    const expires = new Date(NOW.getTime() + 200 * DAY);
    expect(licenceReminders(expires, NOW)).toEqual([
      { daysBefore: 60, sendAfter: new Date(expires.getTime() - 60 * DAY) },
      { daysBefore: 14, sendAfter: new Date(expires.getTime() - 14 * DAY) },
    ]);
  });

  it("send the nearest one now when a window has passed, and one alert for a licence already expired", () => {
    const in30 = new Date(NOW.getTime() + 30 * DAY);
    expect(licenceReminders(in30, NOW)).toEqual([
      { daysBefore: 60, sendAfter: NOW },
      { daysBefore: 14, sendAfter: new Date(in30.getTime() - 14 * DAY) },
    ]);
    expect(licenceReminders(new Date(NOW.getTime() + 5 * DAY), NOW)).toEqual([{ daysBefore: 14, sendAfter: NOW }]);
    expect(licenceReminders(new Date(NOW.getTime() - DAY), NOW)).toEqual([{ daysBefore: 0, sendAfter: NOW }]);
  });
});

describe("going live", () => {
  const firm = (fssaiLicence: string | null) => ({ name: "Gujarat Gummies", fssaiLicence });

  it("needs the manufacturer on file with a licence number, and a named packer's too", () => {
    expect(liveLicenceProblem(null, null)?.field).toBe("manufacturerId");
    expect(liveLicenceProblem(firm(null), null)?.message).toMatch(/Gujarat Gummies has no FSSAI licence number/);
    expect(liveLicenceProblem(firm("10026011000417"), firm(null))?.field).toBe("marketerId");
    expect(liveLicenceProblem(firm("10026011000417"), null)).toBeNull();
  });
});

describe("saving a supplier", () => {
  it("schedules its reminders and cancels any waiting for an old expiry date", async () => {
    const { saveSupplier } = await import("@/server/suppliers");
    const input = supplierSchema.parse(valid);
    expect(await saveSupplier(null, input, NOW)).toEqual({ ok: true, id: "s1" });
    const keys = [licenceReminderKey("s1", input.licenceExpiresOn!, 60), licenceReminderKey("s1", input.licenceExpiresOn!, 14)];
    expect(h.db.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { kind: "supplier_licence_expiry", status: "PENDING", dedupeKey: { startsWith: "supplier_licence:s1:", notIn: keys } },
      data: { status: "CANCELLED" },
    });
    const queued = (h.db.outboundMessage.createMany.mock.calls[0] as unknown as [{ data: { dedupeKey: string; sendAfter: Date }[] }])[0].data;
    expect(queued.map((m) => m.dedupeKey)).toEqual(keys);
  });

  it("won't remove the licence of a firm live products name", async () => {
    h.db.product.count.mockResolvedValueOnce(3);
    const { saveSupplier } = await import("@/server/suppliers");
    const result = await saveSupplier("s1", supplierSchema.parse({ ...valid, fssaiLicence: "", licenceType: null, licenceExpiresOn: null }), NOW);
    expect(result).toMatchObject({ ok: false, field: "fssaiLicence" });
    expect(h.db.supplier.update).not.toHaveBeenCalled();
  });
});

describe("sending a reminder", () => {
  const supplier = { name: "Gujarat Gummies", fssaiLicence: "10026011000417", licenceExpiresOn: new Date("2026-11-03T00:00:00Z"), isActive: true, _count: { manufactured: 2, marketed: 0 } };

  it("emails the owner the firm, the licence, the date and the live products that show it", async () => {
    h.db.supplier.findUnique.mockResolvedValue(supplier);
    const { sendLicenceReminder } = await import("@/server/suppliers");
    expect(await sendLicenceReminder({ supplierId: "s1", expiresOn: "2026-11-03", daysBefore: 60 }, NOW)).toEqual({ delivered: true });
    const mail = (h.emailsSend.mock.calls[0] as unknown as [{ to: string; subject: string; text: string }])[0];
    expect(mail.to).toBe("care@sooulone.in");
    expect(mail.subject).toBe("Gujarat Gummies: FSSAI licence expires in 30 days");
    expect(mail.text).toContain("2 live products show this licence number");
  });

  it("stays quiet once the licence was renewed, or the firm dropped", async () => {
    const { sendLicenceReminder } = await import("@/server/suppliers");
    h.db.supplier.findUnique.mockResolvedValueOnce({ ...supplier, licenceExpiresOn: new Date("2031-11-03T00:00:00Z") });
    expect(await sendLicenceReminder({ supplierId: "s1", expiresOn: "2026-11-03" }, NOW)).toEqual({ delivered: false, reason: "not_due" });
    h.db.supplier.findUnique.mockResolvedValueOnce({ ...supplier, isActive: false });
    expect(await sendLicenceReminder({ supplierId: "s1", expiresOn: "2026-11-03" }, NOW)).toEqual({ delivered: false, reason: "not_due" });
    expect(h.emailsSend).not.toHaveBeenCalled();
  });
});
