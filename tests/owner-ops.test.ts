import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildInvoice } from "@/lib/invoice";
import { csvCell, gstRegisterCsv, hsnSummaryCsv, istMonth, ordersCsv, stockCsv, toCsv, type InvoicedOrder } from "@/lib/exports";
import { attentionLines, digestSubject, salesLine, type DigestData } from "@/lib/digest";
import { safeActivityNext } from "@/lib/step-up-rules";

/** Sprint 5: downloads, bulk order moves and the daily summary (src/lib/exports.ts, src/lib/digest.ts). */

const rowsOf = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

describe("CSV files", () => {
  it("quotes every cell and defuses spreadsheet formulas", () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell(null)).toBe('""');
    const csv = toCsv(["A", "B"], [[1, "x"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(rowsOf(csv)).toEqual(['"A","B"', '"1","x"']);
  });

  it("turns a month into India-time bounds", () => {
    const sep = istMonth("2026-09")!;
    expect(sep.from.toISOString()).toBe("2026-08-31T18:30:00.000Z");
    expect(sep.to.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(istMonth("2026-12")!.to.toISOString()).toBe("2026-12-31T18:30:00.000Z");
    expect(istMonth("2026-13")).toBeNull();
  });

  it("writes an order with India-time dates and rupee amounts", () => {
    const [header, row] = rowsOf(
      ordersCsv([
        {
          orderNumber: "SO-1",
          placedAt: new Date("2026-10-03T20:00:00Z"),
          status: "DELIVERED",
          paymentGateway: "COD",
          paymentStatus: "COD_PENDING",
          items: 2,
          subtotalPaise: 99900,
          discountPaise: 5000,
          shippingPaise: 0,
          totalPaise: 94900,
          name: "Asha Rao",
          phone: "9824011223",
          email: null,
          city: "Ahmedabad",
          pincode: "380015",
          courier: "Delhivery",
          tracking: "AWB1",
          invoiceNumber: "INV/26-27/0001",
          closeReason: null,
        },
      ]),
    );
    expect(header.split(",")[0]).toBe('"Order"');
    expect(row).toBe('"SO-1","2026-10-04 01:30","DELIVERED","Cash on delivery","COD_PENDING","2","999.00","50.00","0.00","949.00","Asha Rao","9824011223","","Ahmedabad","380015","Delhivery","AWB1","INV/26-27/0001",""');
  });

  const invoice = buildInvoice({
    gstTreatment: "INTRA_STATE",
    shippingPaise: 5900,
    shippingTaxPaise: 900,
    totalPaise: 5900 + 11800 + 10500,
    items: [
      { productId: "a", productNameSnapshot: "Ragi Chips", hsnCode: "2106", taxRatePercent: 18, quantity: 1, lineTotalPaise: 11800, taxablePaise: 10000, taxPaise: 1800 },
      { productId: "b", productNameSnapshot: "Biotin Gummies", hsnCode: "2106", taxRatePercent: 5, quantity: 2, lineTotalPaise: 10500, taxablePaise: 10000, taxPaise: 500 },
    ],
  });
  const ORDERS: InvoicedOrder[] = [{ invoiceNumber: "INV/1", invoiceDate: new Date("2026-09-10T06:00:00Z"), orderNumber: "SO-1", buyerName: "Asha", placeOfSupply: "Gujarat", status: "DELIVERED", invoice }];

  it("lists every invoice line, delivery included, with CGST and SGST split as the invoice does", () => {
    const rows = rowsOf(gstRegisterCsv(ORDERS));
    expect(rows).toHaveLength(4); // header, two products, delivery
    expect(rows[1]).toBe('"INV/1","2026-09-10","SO-1","Asha","Gujarat","DELIVERED","Ragi Chips","2106","1","100.00","18","9.00","9.00","0.00","118.00"');
    expect(rows[3]).toContain('"Delivery charges"');
  });

  it("sums the HSN summary per code and rate, with delivery apart", () => {
    const rows = rowsOf(hsnSummaryCsv([...ORDERS, ...ORDERS]));
    expect(rows.slice(1)).toEqual([
      '"2106","5","4","200.00","5.00","5.00","0.00","210.00"',
      '"2106","18","2","200.00","18.00","18.00","0.00","236.00"',
      '"Delivery (SAC)","18","","100.00","9.00","9.00","0.00","118.00"',
    ]);
  });

  it("writes stock with days to best-before", () => {
    const [, row] = rowsOf(
      stockCsv(
        [{ product: "Ragi Chips", brand: "The True Store", batchNumber: "B1", supplier: "SooulOne Foods", receivedOn: new Date("2026-09-01T00:00:00Z"), manufacturedOn: new Date("2026-08-28T00:00:00Z"), expiresOn: new Date("2026-12-01T00:00:00Z"), quantityReceived: 40, quantityRemaining: 12, recalled: false }],
        new Date("2026-10-01T00:00:00Z"),
      ),
    );
    expect(row).toBe('"Ragi Chips","The True Store","B1","SooulOne Foods","2026-09-01","2026-08-28","2026-12-01","61","40","12","no"');
  });
});

describe("the authenticator step's way back", () => {
  it("returns to an activity page or download, options included, and nowhere else", () => {
    expect(safeActivityNext("/admin/activity/export/orders?from=2026-09-01&to=2026-09-30")).toBe("/admin/activity/export/orders?from=2026-09-01&to=2026-09-30");
    expect(safeActivityNext("/admin/activity/export/orders?ids=abc,def")).toBe("/admin/activity/export/orders?ids=abc,def");
    expect(safeActivityNext("https://evil.example/admin/activity")).toBe("/admin/activity");
    expect(safeActivityNext("/admin/activity/export/orders?x=<script>")).toBe("/admin/activity");
    expect(safeActivityNext("//evil.example")).toBe("/admin/activity");
  });
});

describe("bulk order moves", () => {
  it("go through the same change as the order page's form", () => {
    const source = readFileSync(join(__dirname, "..", "src/app/admin/(console)/actions.ts"), "utf8");
    const bulk = source.slice(source.indexOf("export async function bulkSetOrderStatus"), source.indexOf("async function changeOrderStatus"));
    expect(bulk).toContain("changeOrderStatus(session");
    expect(bulk).toContain('requirePermission("orders:write")');
    // Only the moves that need nothing typed in.
    expect(source).toContain('const BULK_MOVES = { PROCESSING: "PAID", DELIVERED: "SHIPPED" } as const;');
    expect(source).not.toMatch(/^export async function changeOrderStatus/m);
  });
});

const QUIET: DigestData = {
  yesterday: { orders: 4, revenuePaise: 207200 },
  weekBefore: { orders: 9, revenuePaise: 480000 },
  toPack: 0,
  oldestWaitingDays: null,
  returnsToCheck: 0,
  failedMessages: 0,
  newEnquiries: 0,
  pendingReviews: 0,
  runningLow: [],
  nearUnsellable: [],
  licences: [],
  insights: [],
};

describe("the daily summary", () => {
  it("compares yesterday with the same day last week", () => {
    expect(salesLine(QUIET)).toBe("Yesterday: 4 orders, ₹2,072, down 57% on 9 orders, ₹4,800 the same day last week.");
    expect(salesLine({ ...QUIET, weekBefore: { orders: 0, revenuePaise: 0 } })).toBe("Yesterday: 4 orders, ₹2,072.");
  });

  it("says all clear when nothing needs doing", () => {
    expect(attentionLines(QUIET)).toEqual([]);
    expect(digestSubject(QUIET)).toBe("SooulOne today: all clear · 4 orders yesterday");
  });

  it("puts what needs doing today first, each with its console link", () => {
    const d: DigestData = {
      ...QUIET,
      toPack: 9,
      oldestWaitingDays: 3,
      returnsToCheck: 2,
      newEnquiries: 1,
      runningLow: [{ name: "Til Chikki", shippable: 0 }],
      licences: [
        { supplier: "SooulOne Foods", days: null, missing: true, usedByLive: true },
        { supplier: "Old Mill", days: 5, missing: false, usedByLive: true },
        { supplier: "Unused Co", days: 3, missing: false, usedByLive: false },
      ],
    };
    const lines = attentionLines(d);
    expect(lines.map((l) => [l.text, l.path, l.urgent])).toEqual([
      ["9 orders to pack and ship, the oldest waiting 3 days", "/admin/orders?view=to_ship", true],
      ["SooulOne Foods has no FSSAI licence number", "/admin/suppliers", true],
      ["Old Mill's FSSAI licence expires in 5 days", "/admin/suppliers", true],
      ["2 returned parcels to check", "/admin/orders?view=returned", true],
      ["1 product running low: Til Chikki (0)", "/admin/batches", false],
      ["1 enquiry waiting for a reply", "/admin/enquiries", false],
    ]);
    expect(digestSubject(d)).toBe("SooulOne today: 4 things to do · 4 orders yesterday");
  });
});
