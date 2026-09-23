import { describe, expect, it } from "vitest";
import { buildOrderBill } from "../src/lib/order-bill";
import { esc, renderOrderConfirmation } from "../src/lib/email-templates";

const order = (over: Record<string, unknown> = {}) => ({
  orderNumber: "SO-TEST-01",
  placedAt: "2026-09-19T10:00:00Z",
  paymentGateway: "RAZORPAY",
  subtotal: "940.00",
  productDiscountAmount: "60.00",
  bundleDiscountAmount: "94.00",
  bundleLabel: "Diwali Hamper",
  discountAmount: "84.60",
  couponCode: "WELCOME10",
  shippingAmount: "0.00",
  taxAmount: "81.21",
  totalAmount: "761.40",
  shippingAddress: {
    name: "Asha Rao",
    line1: "12 MG Road",
    line2: null,
    city: "Pune",
    state: "Maharashtra",
    postalCode: "411001",
  },
  items: [
    // one product drawn from two batches must collapse to a single bill line
    { productId: "p1", variantId: null, productNameSnapshot: "Masala Chana", unitPriceSnapshot: "470.00", listUnitPriceSnapshot: "500.00", quantity: 1, lineTotal: "470.00" },
    { productId: "p1", variantId: null, productNameSnapshot: "Masala Chana", unitPriceSnapshot: "470.00", listUnitPriceSnapshot: "500.00", quantity: 1, lineTotal: "470.00" },
  ],
  ...over,
});

describe("buildOrderBill", () => {
  it("groups per-batch rows into one line per product", () => {
    const bill = buildOrderBill(order());
    expect(bill.lines).toHaveLength(1);
    expect(bill.lines[0]).toMatchObject({
      quantity: 2,
      listUnitPaise: 50000,
      unitPaise: 47000,
      lineTotalPaise: 94000,
      percentOff: 6,
    });
  });

  it("reports every layer of discount and the total saved", () => {
    const bill = buildOrderBill(order());
    expect(bill.mrpSubtotalPaise).toBe(100000);
    expect(bill.productDiscountPaise).toBe(6000);
    expect(bill.bundle).toEqual({ label: "Diwali Hamper", amountPaise: 9400 });
    expect(bill.coupon).toEqual({ code: "WELCOME10", amountPaise: 8460 });
    expect(bill.totalSavingsPaise).toBe(6000 + 9400 + 8460);
    expect(bill.totalPaise).toBe(76140);
  });

  it("handles orders that predate discounts (no list snapshot, no new fields)", () => {
    const bill = buildOrderBill(
      order({
        productDiscountAmount: undefined,
        bundleDiscountAmount: undefined,
        discountAmount: "0.00",
        couponCode: null,
        totalAmount: "940.00",
        items: [
          { productId: "p1", productNameSnapshot: "Masala Chana", unitPriceSnapshot: "470.00", quantity: 2, lineTotal: "940.00" },
        ],
      }),
    );
    expect(bill.lines[0].percentOff).toBeNull();
    expect(bill.bundle).toBeNull();
    expect(bill.coupon).toBeNull();
    expect(bill.totalSavingsPaise).toBe(0);
  });
});

describe("renderOrderConfirmation", () => {
  const rendered = renderOrderConfirmation(buildOrderBill(order()));

  it("shows the struck-through original price beside the discounted one", () => {
    expect(rendered.html).toContain("line-through");
    expect(rendered.html).toContain("₹500.00");
    expect(rendered.html).toContain("₹470.00");
    expect(rendered.html).toContain("6% off");
  });

  it("itemises product, bundle and coupon discounts and the total", () => {
    for (const s of [
      "Product discounts",
      "Bundle offer: Diwali Hamper",
      "WELCOME10",
      "₹761.40",
      "Includes GST of ₹81.21",
      "You saved ₹238.60",
    ]) {
      expect(rendered.html).toContain(s);
    }
  });

  it("is responsive: viewport meta, fluid card and a mobile media query", () => {
    expect(rendered.html).toContain('name="viewport"');
    expect(rendered.html).toContain("max-width:600px");
    expect(rendered.html).toContain("@media only screen");
  });

  it("ships a plain-text twin with the same figures", () => {
    expect(rendered.text).toContain("Masala Chana");
    expect(rendered.text).toContain("₹761.40");
    expect(rendered.text).toContain("was ₹500.00");
  });

  it("says 'Total to pay' for cash on delivery", () => {
    const cod = renderOrderConfirmation(buildOrderBill(order({ paymentGateway: "COD" })));
    expect(cod.html).toContain("Total to pay");
    expect(cod.html).not.toContain("Total paid");
    expect(cod.html).toContain("pay the courier");
  });

  it("omits the savings banner when nothing was discounted", () => {
    const plain = renderOrderConfirmation(
      buildOrderBill(
        order({
          productDiscountAmount: "0",
          bundleDiscountAmount: "0",
          discountAmount: "0",
          items: [{ productId: "p", productNameSnapshot: "X", unitPriceSnapshot: "100", quantity: 1, lineTotal: "100" }],
        }),
      ),
    );
    expect(plain.html).not.toContain("You saved");
  });

  it("escapes customer- and admin-supplied text", () => {
    const evil = renderOrderConfirmation(
      buildOrderBill(
        order({
          shippingAddress: { name: '<img src=x onerror="alert(1)">', line1: "1 <b>Road</b>", city: "Pune", state: "MH", postalCode: "411001" },
          items: [{ productId: "p", productNameSnapshot: "<script>alert(1)</script>", unitPriceSnapshot: "100", quantity: 1, lineTotal: "100" }],
        }),
      ),
    );
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).not.toContain("<img src=x");
    expect(evil.html).toContain("&lt;script&gt;");
    expect(esc("\"'&")).toBe("&quot;&#39;&amp;");
  });
});
