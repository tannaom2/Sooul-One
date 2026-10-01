import { describe, expect, it, vi } from "vitest";
import { sellerForInvoice, sellerSnapshot } from "@/lib/invoice";

vi.mock("server-only", () => ({}));

/** Launch defect D3: an issued GST invoice never changes when Business details do. */

const ISSUED = { legalName: "SooulOne Consumer Brands Pvt Ltd", registeredAddress: "4th Floor, Parishram, Ahmedabad", gstin: "24AAKCS4821M1ZX" };
const TODAY = { legalName: "SooulOne Consumer Brands Pvt Ltd", registeredAddress: "New office, Surat", gstin: "24ZZZZZ9999Z1Z9", customerCareEmail: "care@sooulone.in" };

describe("seller snapshot", () => {
  it("keeps only the printed fields, missing ones as null", () => {
    expect(sellerSnapshot({ ...ISSUED, grievanceOfficerName: "Kavita", id: "default" })).toEqual({
      legalName: ISSUED.legalName,
      tradeName: null,
      registeredAddress: ISSUED.registeredAddress,
      gstin: ISSUED.gstin,
      fssaiLicence: null,
      customerCareEmail: null,
      customerCarePhone: null,
    });
  });

  it("prints what was true when the invoice was issued, not today's details", () => {
    const seller = sellerForInvoice(sellerSnapshot(ISSUED), TODAY);
    expect(seller.registeredAddress).toBe("4th Floor, Parishram, Ahmedabad");
    expect(seller.gstin).toBe("24AAKCS4821M1ZX");
    expect(seller.customerCareEmail).toBeNull(); // not set at the time, so not printed now either
  });

  it("falls back to today's details only for an invoice with no snapshot", () => {
    expect(sellerForInvoice(null, TODAY)).toBe(TODAY);
    expect(sellerForInvoice("nonsense", TODAY)).toBe(TODAY);
  });
});

describe("issuing an invoice number", () => {
  it("freezes the seller's details onto the order in the same transaction", async () => {
    const update = vi.fn();
    const tx = {
      $queryRaw: vi.fn(async () => [{ lastNumber: 7 }]),
      businessProfile: { findUnique: vi.fn(async () => ({ id: "default", ...ISSUED, fssaiLicence: "10726001000417" })) },
      order: { update },
    };
    const { issueInvoiceNumber } = await import("@/server/invoice-number");
    const number = await issueInvoiceNumber(tx as never, "o1", new Date("2026-10-05T10:00:00Z"));
    expect(update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: expect.objectContaining({ invoiceNumber: number, sellerSnapshot: expect.objectContaining({ gstin: ISSUED.gstin, fssaiLicence: "10726001000417" }) }),
    });
  });
});
