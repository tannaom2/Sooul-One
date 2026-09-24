import { describe, expect, it } from "vitest";
import { amountInWords, apportion, buildInvoice, financialYear, formatInvoiceNumber, stateCode } from "../src/lib/invoice";

describe("financialYear", () => {
  it("turns over at midnight on 1 April, India time", () => {
    expect(financialYear(new Date("2027-03-31T18:29:00Z"))).toBe("2026-27"); // 23:59 IST, 31 March
    expect(financialYear(new Date("2027-03-31T18:31:00Z"))).toBe("2027-28"); // 00:01 IST, 1 April
    expect(financialYear(new Date("2026-09-26T06:00:00Z"))).toBe("2026-27");
  });
});

describe("formatInvoiceNumber", () => {
  it("is consecutive, per year, and within GST's 16-character limit", () => {
    const n = formatInvoiceNumber("2026-27", 123);
    expect(n).toBe("SO/26-27/000123");
    expect(n.length).toBeLessThanOrEqual(16);
    expect(formatInvoiceNumber("2026-27", 999999).length).toBeLessThanOrEqual(16);
  });
});

describe("stateCode", () => {
  it("gives the GST state code for place of supply", () => {
    expect(stateCode("Gujarat")).toBe("24");
    expect(stateCode(" gujarat ")).toBe("24");
    expect(stateCode("Dadra & Nagar Haveli and Daman & Diu")).toBe("26");
    expect(stateCode("Atlantis")).toBeNull();
  });
});

describe("amountInWords", () => {
  it("uses the Indian system: thousand, lakh, crore", () => {
    expect(amountInWords(25800)).toBe("Rupees Two Hundred Fifty-Eight Only");
    expect(amountInWords(25850)).toBe("Rupees Two Hundred Fifty-Eight and Fifty Paise Only");
    expect(amountInWords(12_34_567_00)).toBe("Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven Only");
    expect(amountInWords(1_00_00_000_00)).toBe("Rupees One Crore Only");
  });
});

describe("apportion", () => {
  it("splits exactly, with the rounding on the last part", () => {
    expect(apportion(1000, [1, 1, 1])).toEqual([333, 333, 334]);
    expect(apportion(999, [2, 1]).reduce((a, b) => a + b, 0)).toBe(999);
  });
});

describe("buildInvoice", () => {
  const item = (over: object = {}) => ({
    productId: "p1",
    productNameSnapshot: "Roasted Chana",
    hsnCode: "20081990",
    taxRatePercent: 12,
    quantity: 1,
    lineTotalPaise: 11200,
    taxablePaise: 10000,
    taxPaise: 1200,
    ...over,
  });

  it("uses the tax recorded at checkout, merges batch rows, and adds delivery", () => {
    const inv = buildInvoice({
      gstTreatment: "INTRA_STATE",
      shippingPaise: 5900,
      shippingTaxPaise: 900,
      totalPaise: 11200 * 2 + 5900,
      items: [item(), item({ quantity: 1 })],
    });
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines[0]).toMatchObject({ quantity: 2, taxablePaise: 20000, cgstPaise: 1200, sgstPaise: 1200, igstPaise: 0 });
    expect(inv.lines[1]).toMatchObject({ description: "Delivery charges", taxablePaise: 5000, cgstPaise: 450, sgstPaise: 450, ratePercent: 18 });
    expect(inv.totalPaise).toBe(28300);
    expect(inv.approximate).toBe(false);
  });

  it("gives the odd paisa to CGST, as checkout does", () => {
    const inv = buildInvoice({ gstTreatment: "INTRA_STATE", shippingPaise: 0, shippingTaxPaise: 0, totalPaise: 11201, items: [item({ lineTotalPaise: 11201, taxablePaise: 10000, taxPaise: 1201 })] });
    expect(inv.cgstPaise).toBe(601);
    expect(inv.sgstPaise).toBe(600);
  });

  it("charges IGST instead for an interstate order", () => {
    const inv = buildInvoice({ gstTreatment: "INTER_STATE", shippingPaise: 0, shippingTaxPaise: 0, totalPaise: 11200, items: [item()] });
    expect(inv).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 1200 });
  });

  it("flags an order placed before tax was recorded, rather than pretending it's exact", () => {
    const inv = buildInvoice({ gstTreatment: "INTRA_STATE", shippingPaise: 0, shippingTaxPaise: null, totalPaise: 11200, items: [item({ taxablePaise: null, taxPaise: null })] });
    expect(inv.approximate).toBe(true);
    expect(inv.totalPaise).toBe(11200);
  });
});
