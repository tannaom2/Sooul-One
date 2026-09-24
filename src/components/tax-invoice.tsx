import { formatINR } from "@/lib/money";
import { decimalToPaise } from "@/lib/format";
import { buildInvoice, stateCode } from "@/lib/invoice";
import type { GstTreatment } from "@/lib/money";
import type { BusinessProfile } from "@/server/business";
import { PrintButton } from "./print-button";

/* eslint-disable @typescript-eslint/no-explicit-any */

const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
const money = (paise: number) => formatINR(paise);
const paiseOrNull = (v: unknown) => (v == null ? null : decimalToPaise(v as any));

/**
 * A GST tax invoice for one shipped order, built by buildInvoice from the tax
 * recorded at checkout. Rendered on the customer's order link and in admin;
 * prints cleanly (site header, footer and admin sidebar are hidden in print).
 */
export function TaxInvoice({ order, seller }: { order: any; seller: BusinessProfile }) {
  const invoice = buildInvoice({
    gstTreatment: (order.gstTreatment as GstTreatment | null) ?? null,
    shippingPaise: decimalToPaise(order.shippingAmount),
    shippingTaxPaise: paiseOrNull(order.shippingTaxAmount),
    totalPaise: decimalToPaise(order.totalAmount),
    items: order.items.map((i: any) => ({
      productId: i.productId,
      productNameSnapshot: i.productNameSnapshot,
      hsnCode: i.hsnCode ?? i.product?.hsnCode ?? null,
      taxRatePercent: i.taxRatePercent != null ? Number(i.taxRatePercent) : i.product?.taxRatePercent != null ? Number(i.product.taxRatePercent) : null,
      quantity: i.quantity,
      lineTotalPaise: decimalToPaise(i.lineTotal),
      taxablePaise: paiseOrNull(i.taxableAmount),
      taxPaise: paiseOrNull(i.taxAmount),
    })),
  });
  const ship = order.shippingAddress ?? {};
  const bill = order.billingAddress ?? ship;
  const supplyCode = stateCode(ship.state);
  const intra = invoice.treatment === "INTRA_STATE";
  const sellerName = seller.legalName ?? "Seller name not yet set";

  return (
    <div className="mx-auto max-w-4xl bg-paper px-5 py-8 text-small print:max-w-none print:px-0 print:py-0">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <p className="text-ink-soft">Keep this for your records, or print it.</p>
        <PrintButton />
      </div>

      {!seller.gstin && (
        <p className="mb-4 border-l-4 border-alert bg-shelf p-3">
          Not a valid tax invoice yet: the seller&apos;s GSTIN isn&apos;t set in Business details.
        </p>
      )}

      <div className="border border-ink">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink p-4">
          <div>
            <p className="text-h3 font-extrabold">{sellerName}</p>
            {seller.tradeName && <p>{seller.tradeName}</p>}
            {seller.registeredAddress && <p className="max-w-[40ch] whitespace-pre-line text-ink-soft">{seller.registeredAddress}</p>}
            {seller.gstin && <p className="tabular">GSTIN {seller.gstin}</p>}
            {seller.fssaiLicence && <p className="tabular">FSSAI licence {seller.fssaiLicence}</p>}
          </div>
          <div className="text-right">
            <p className="text-h3 font-extrabold tracking-wide uppercase">Tax invoice</p>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-3 gap-y-0.5">
              <dt className="text-ink-soft">Invoice no.</dt>
              <dd className="tabular font-semibold">{order.invoiceNumber}</dd>
              <dt className="text-ink-soft">Invoice date</dt>
              <dd>{date.format(order.invoiceDate)}</dd>
              <dt className="text-ink-soft">Order</dt>
              <dd className="tabular">{order.orderNumber}</dd>
              <dt className="text-ink-soft">Order date</dt>
              <dd>{date.format(order.placedAt)}</dd>
            </dl>
          </div>
        </div>

        <div className="grid gap-4 border-b border-ink p-4 sm:grid-cols-3">
          {[
            ["Bill to", bill],
            ["Ship to", ship],
          ].map(([label, a]: any) => (
            <div key={label}>
              <p className="font-semibold">{label}</p>
              <p>{a.name}</p>
              <p className="text-ink-soft">
                {[a.line1, a.line2].filter(Boolean).join(", ")}
                <br />
                {a.city}, {a.state} {a.postalCode}
              </p>
              {a.phone && <p className="tabular text-ink-soft">{a.phone}</p>}
            </div>
          ))}
          <div>
            <p className="font-semibold">Place of supply</p>
            <p>
              {ship.state}
              {supplyCode && ` (${supplyCode})`}
            </p>
            <p className="mt-2 font-semibold">Tax is payable on reverse charge</p>
            <p>No</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-micro sm:text-small">
            <thead>
              <tr className="border-b border-ink text-left">
                <th className="p-2">#</th>
                <th className="p-2">Description</th>
                <th className="p-2">HSN</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Taxable value</th>
                <th className="p-2 text-right">GST %</th>
                {intra ? (
                  <>
                    <th className="p-2 text-right">CGST</th>
                    <th className="p-2 text-right">SGST</th>
                  </>
                ) : (
                  <th className="p-2 text-right">IGST</th>
                )}
                <th className="p-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, i) => (
                <tr key={i} className="border-b border-[--color-rule] align-top">
                  <td className="p-2 tabular">{i + 1}</td>
                  <td className="p-2">{l.description}</td>
                  <td className="p-2 tabular">{l.hsn ?? "—"}</td>
                  <td className="p-2 text-right tabular">{l.quantity ?? "—"}</td>
                  <td className="p-2 text-right tabular">{money(l.taxablePaise)}</td>
                  <td className="p-2 text-right tabular">{l.ratePercent}%</td>
                  {intra ? (
                    <>
                      <td className="p-2 text-right tabular">{money(l.cgstPaise)}</td>
                      <td className="p-2 text-right tabular">{money(l.sgstPaise)}</td>
                    </>
                  ) : (
                    <td className="p-2 text-right tabular">{money(l.igstPaise)}</td>
                  )}
                  <td className="p-2 text-right tabular">{money(l.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink font-semibold">
                <td className="p-2" colSpan={4}>
                  Total
                </td>
                <td className="p-2 text-right tabular">{money(invoice.taxablePaise)}</td>
                <td className="p-2" />
                {intra ? (
                  <>
                    <td className="p-2 text-right tabular">{money(invoice.cgstPaise)}</td>
                    <td className="p-2 text-right tabular">{money(invoice.sgstPaise)}</td>
                  </>
                ) : (
                  <td className="p-2 text-right tabular">{money(invoice.igstPaise)}</td>
                )}
                <td className="p-2 text-right tabular">{money(invoice.totalPaise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="grid gap-1 border-t border-ink p-4">
          <p>
            <span className="font-semibold">Amount in words:</span> {invoice.totalInWords}
          </p>
          {decimalToPaise(order.discountAmount) + decimalToPaise(order.bundleDiscountAmount) > 0 && (
            <p className="text-ink-soft">Values are after the discounts applied to this order.</p>
          )}
          {invoice.approximate && (
            <p className="text-alert">Some tax figures were worked out from current rates because this order predates tax recording.</p>
          )}
          <p className="mt-2 text-ink-soft">
            This is a computer-generated invoice and needs no signature.
            {seller.customerCareEmail && ` Questions: ${seller.customerCareEmail}`}
            {seller.customerCarePhone && ` · ${seller.customerCarePhone}`}
          </p>
        </div>
      </div>
    </div>
  );
}
