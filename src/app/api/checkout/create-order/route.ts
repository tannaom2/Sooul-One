import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { db } from "@/lib/db";
import { quoteCart, readSessionId } from "@/server/cart";
import { orderNumber } from "@/lib/format";
import { fromPaise } from "@/lib/money";
import { sendOrderConfirmation } from "@/lib/email";
import { recordEvent } from "@/lib/analytics";
import { checkoutInputSchema } from "@/lib/validation/checkout";

/**
 * Create an order and hand the shopper to Razorpay.
 *
 * ORDER OF OPERATIONS
 *   1. Re-quote server-side. The client's figures are never trusted — they are
 *      a display artefact, and the compliance check has to run against live
 *      batch data at the moment of payment, not at the moment of browsing.
 *   2. Refuse outright if any line is blocked. A blocked line means the
 *      shelf-life rule would be breached, and that is not a "warn and proceed".
 *   3. Write the order and decrement batch stock in one transaction, so two
 *      simultaneous checkouts cannot both claim the last compliant batch.
 *   4. Create the Razorpay order and return its id. Payment confirmation
 *      arrives later via the webhook, never from the browser.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ message: "Your basket is empty." }, { status: 400 });
  }

  const parsed = checkoutInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Check the highlighted fields.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // --- 1 & 2: authoritative re-quote --------------------------------------
  const result = await quoteCart(sessionId, {
    pincode: input.postalCode,
    state: input.state,
    couponCode: input.couponCode,
  });

  if (!result) return NextResponse.json({ message: "Your basket is empty." }, { status: 400 });

  const { quote } = result;

  if (!quote.canProceed) {
    const blocked = quote.lines.filter((l) => l.status !== "OK");
    return NextResponse.json(
      {
        message: "Some items in your basket can't be sent right now.",
        blocked: blocked.map((l) => ({ name: l.name, reason: l.customerMessage })),
      },
      { status: 409 },
    );
  }

  const address = {
    name: input.name,
    line1: input.line1,
    line2: input.line2 ?? null,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: "IN",
    phone: input.phone,
  };

  // --- 3: persist order and consume batch stock atomically -----------------
  const order = await db.$transaction(async (tx: any) => {
    const created = await tx.order.create({
      data: {
        orderNumber: orderNumber(),
        sessionId,
        guestEmail: input.email,
        guestPhone: input.phone,
        status: "PENDING_PAYMENT",
        subtotal: fromPaise(quote.subtotalPaise),
        productDiscountAmount: fromPaise(quote.productDiscountPaise),
        bundleDiscountAmount: fromPaise(quote.bundleDiscountPaise),
        bundleLabel: quote.appliedBundles.length
          ? quote.appliedBundles.map((b) => b.name).join(", ")
          : null,
        discountAmount: fromPaise(quote.discountPaise),
        shippingAmount: fromPaise(quote.shippingPaise),
        taxAmount: fromPaise(quote.taxPaise),
        totalAmount: fromPaise(quote.totalPaise),
        couponCode: quote.appliedCouponCode ?? null,
        shippingAddress: address,
        billingAddress: address,
        paymentGateway: input.paymentMethod === "COD" ? "COD" : "RAZORPAY",
      },
    });

    for (const line of quote.lines) {
      // One OrderItem per batch drawn, so recall traceability survives a line
      // that was filled from two different lots.
      const allocations = line.allocations.length
        ? line.allocations
        : [{ batchId: null, quantity: line.quantityAvailable }];

      for (const allocation of allocations as { batchId: string | null; quantity: number }[]) {
        await tx.orderItem.create({
          data: {
            orderId: created.id,
            productId: line.productId,
            variantId: line.variantId ?? null,
            batchId: allocation.batchId,
            productNameSnapshot: line.name,
            unitPriceSnapshot: fromPaise(
              Math.round(line.grossPaise / Math.max(line.quantityAvailable, 1)),
            ),
            listUnitPriceSnapshot: fromPaise(
              Math.round(line.listGrossPaise / Math.max(line.quantityAvailable, 1)),
            ),
            quantity: allocation.quantity,
            lineTotal: fromPaise(
              Math.round((line.grossPaise / Math.max(line.quantityAvailable, 1)) * allocation.quantity),
            ),
          },
        });

        if (allocation.batchId) {
          await tx.productBatch.update({
            where: { id: allocation.batchId },
            data: { quantityRemaining: { decrement: allocation.quantity } },
          });
        }
      }

      await tx.product.update({
        where: { id: line.productId },
        data: { stockQuantity: { decrement: line.quantityAvailable } },
      });
    }

    if (quote.appliedCouponCode) {
      await tx.coupon.update({
        where: { code: quote.appliedCouponCode },
        data: { usedCount: { increment: 1 } },
      });
    }

    return created;
  });

  void recordEvent(sessionId, "ORDER_PLACED", {
    orderId: order.id,
    metadata: { totalPaise: quote.totalPaise, method: input.paymentMethod },
  });

  // --- Cash on delivery needs no gateway -----------------------------------
  if (input.paymentMethod === "COD") {
    const confirmed = await db.order.update({
      where: { id: order.id },
      data: { status: "PROCESSING", paymentStatus: "COD_PENDING" },
      include: { items: true },
    });

    // COD has no gateway to confirm a later capture, so — unlike RAZORPAY,
    // where ORDER_PAID waits for the signature-verified webhook — this is the
    // one path where the funnel's "paid" step means "order confirmed," not
    // "money verified."
    void recordEvent(sessionId, "ORDER_PAID", {
      orderId: order.id,
      metadata: { totalPaise: quote.totalPaise, method: "COD" },
    });

    // A COD order never reaches the Razorpay webhook, so its confirmation is
    // sent from here instead. Awaited but non-throwing: sendOrderConfirmation
    // swallows its own failures, so a mail outage cannot turn a placed order
    // into a 500 the customer would reasonably retry.
    await sendOrderConfirmation(confirmed);

    return NextResponse.json({ orderNumber: order.orderNumber, method: "COD" });
  }

  // --- 4: hosted checkout --------------------------------------------------
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    // The order exists but cannot be paid for. Say so precisely rather than
    // leaving a PENDING_PAYMENT row nobody can explain.
    return NextResponse.json(
      {
        message:
          "Card payment isn't configured on this deployment. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, or choose cash on delivery.",
        orderNumber: order.orderNumber,
      },
      { status: 503 },
    );
  }

  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const rzpOrder = await razorpay.orders.create({
    amount: quote.totalPaise, // Razorpay works in paise, which is why we do too
    currency: "INR",
    receipt: order.orderNumber,
    notes: { orderId: order.id },
  });

  await db.order.update({ where: { id: order.id }, data: { paymentId: rzpOrder.id } });

  return NextResponse.json({
    orderNumber: order.orderNumber,
    method: "RAZORPAY",
    razorpayOrderId: rzpOrder.id,
    keyId,
    amount: quote.totalPaise,
  });
}
