import { NextResponse, after } from "next/server";
import Razorpay from "razorpay";
import { db } from "@/lib/db";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";
import { quoteCart, readSessionId, writeBasketCount } from "@/server/cart";
import { takeStock } from "@/server/order-stock";
import { orderNumber } from "@/lib/format";
import { fromPaise } from "@/lib/money";
import { apportion } from "@/lib/invoice";
import { sendOrderConfirmation } from "@/lib/email";
import { recordEvent } from "@/lib/analytics";
import { checkoutInputSchema } from "@/lib/validation/checkout";
import { OUTSIDE_AREA_MESSAGE, isServiceable } from "@/lib/checkout/service-area";
import { lookupPincode } from "@/server/pincode";
import { newOrderAccessToken } from "@/lib/order-access";
import { recordOrderEvent } from "@/lib/order-events";

import { getCheckoutState } from "@/server/store-settings";
import { MARKETING_CONSENT_TEXT } from "@/lib/consent";
import { reportError } from "@/lib/observability";
import { limitPublic } from "@/server/rate-limit";

/**
 * Create an order and hand the shopper to Razorpay.
 *
 * ORDER OF OPERATIONS
 *   1. Re-quote server-side. The client's figures are never trusted — they are
 *      a display artefact, and the compliance check has to run against live
 *      batch data at the moment of payment, not at the moment of browsing.
 *   2. Refuse outright if any line is blocked. A blocked line means the
 *      shelf-life rule would be breached, and that is not a "warn and proceed".
 *   3. Write the order and decrement batch stock in one transaction. Each
 *      decrement is conditional on enough stock remaining (and a database
 *      CHECK backs it), so two simultaneous checkouts cannot both claim the
 *      last compliant batch: the second one rolls back and is told it sold out.
 *   4. Create the Razorpay order and return its id. Payment confirmation
 *      arrives later via the webhook, never from the browser.
 */


/** Another checkout took the stock between the quote and this transaction. */
class SoldOut extends Error {
  constructor(readonly productName: string) {
    super(`Sold out: ${productName}`);
  }
}

/** The coupon reached its maxUses between the quote and this transaction. */
class CouponUsedUp extends Error {}

export async function POST(request: Request) {
  const limited = await limitPublic("createOrder");
  if (limited) return limited;

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

  // Same decision the checkout page made (src/lib/store-controls.ts): the
  // launch gate, the owner's pause, and which payment methods are on.
  // Checked before anything is reserved.
  const checkout = await getCheckoutState();
  if (!checkout.open) {
    return NextResponse.json({ message: checkout.message }, { status: 503 });
  }
  const method = input.paymentMethod === "COD" ? "COD" : "ONLINE";
  if (!checkout.methods.includes(method)) {
    return NextResponse.json(
      {
        message:
          method === "COD"
            ? "Cash on delivery isn't available right now. Choose another way to pay."
            : "Online payment isn't available yet. Choose cash on delivery.",
      },
      { status: 400 },
    );
  }

  // Delivery area (Gujarat only, service-area.ts). Checked against India
  // Post's state for the pincode, not the typed one; if the directory is
  // unreachable, the pincode range and typed state still have to agree.
  const directory = await lookupPincode(input.postalCode).catch(() => null);
  if (!isServiceable(input.postalCode, input.state, directory?.state)) {
    return NextResponse.json(
      { message: OUTSIDE_AREA_MESSAGE, issues: [{ path: ["postalCode"], message: OUTSIDE_AREA_MESSAGE }] },
      { status: 400 },
    );
  }

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

  // --- 3: persist order and consume stock atomically -----------------------
  // Everything is worked out before the transaction opens, so it holds its
  // connection for as few round trips as possible: each one is a full trip to
  // the database, and a long transaction is what failed under load.
  const isCod = input.paymentMethod === "COD";

  // One OrderItem per batch drawn, so recall traceability survives a line
  // that was filled from two different lots.
  // Tax facts are recorded as charged, for the GST invoice (src/lib/invoice.ts):
  // the HSN and rate of the day, and each row's share of the line's taxable
  // value and tax after every discount, split exactly across its batches.
  const hsnByProduct = new Map(result.cartItems.map((i) => [i.productId, i.product.hsnCode ?? null]));
  const itemRows = quote.lines.flatMap((line) => {
    const unit = line.grossPaise / Math.max(line.quantityAvailable, 1);
    const allocations: { batchId: string | null; quantity: number }[] = line.allocations.length
      ? line.allocations.map((a) => ({ batchId: a.batchId, quantity: a.quantity }))
      : [{ batchId: null, quantity: line.quantityAvailable }];
    const weights = allocations.map((a) => a.quantity);
    const taxable = apportion(line.taxablePaise, weights);
    const tax = apportion(line.taxPaise, weights);
    return allocations.map((allocation, i) => ({
      productId: line.productId,
      variantId: line.variantId ?? null,
      batchId: allocation.batchId,
      productNameSnapshot: line.name,
      unitPriceSnapshot: fromPaise(Math.round(unit)),
      listUnitPriceSnapshot: fromPaise(Math.round(line.listGrossPaise / Math.max(line.quantityAvailable, 1))),
      quantity: allocation.quantity,
      lineTotal: fromPaise(Math.round(unit * allocation.quantity)),
      hsnCode: hsnByProduct.get(line.productId) ?? null,
      taxRatePercent: line.taxRatePercent,
      taxableAmount: fromPaise(taxable[i]),
      taxAmount: fromPaise(tax[i]),
    }));
  });
  const shippingTaxPaise = quote.taxPaise - quote.lines.reduce((sum, l) => sum + l.taxPaise, 0);
  // Batches are the only stock record; the product totals follow by trigger.
  const batchTakes = quote.lines.flatMap((line) =>
    line.allocations.map((a) => ({ id: a.batchId, qty: a.quantity, name: line.name })),
  );

  const order = await db
    .$transaction(
      async (tx) => {
        const created = await tx.order.create({
          data: {
            orderNumber: orderNumber(),
            accessToken: newOrderAccessToken(),
            sessionId,
            guestEmail: input.email,
            guestPhone: input.phone,
            // Cash on delivery is confirmed the moment it's placed; online
            // orders wait for the webhook.
            status: isCod ? "PROCESSING" : "PENDING_PAYMENT",
            paymentStatus: isCod ? "COD_PENDING" : null,
            subtotal: fromPaise(quote.subtotalPaise),
            productDiscountAmount: fromPaise(quote.productDiscountPaise),
            bundleDiscountAmount: fromPaise(quote.bundleDiscountPaise),
            bundleLabel: quote.appliedBundles.length ? quote.appliedBundles.map((b) => b.name).join(", ") : null,
            discountAmount: fromPaise(quote.discountPaise),
            shippingAmount: fromPaise(quote.shippingPaise),
            taxAmount: fromPaise(quote.taxPaise),
            totalAmount: fromPaise(quote.totalPaise),
            couponCode: quote.appliedCouponCode ?? null,
            shippingAddress: address,
            billingAddress: address,
            paymentGateway: isCod ? "COD" : "RAZORPAY",
            // What the shopper was shown, for measuring on-time delivery later.
            promisedDeliveryDate: result.estimatedDeliveryDate,
            shippingTaxAmount: fromPaise(shippingTaxPaise),
            gstTreatment: result.gstTreatment,
          },
        });
        // A separate createMany rather than a nested write: nesting costs an
        // extra statement per relation plus a re-read of the order.
        await tx.orderItem.createMany({ data: itemRows.map((row) => ({ ...row, orderId: created.id })) });

        // A COD order is final once placed, so its basket empties with it.
        // (Online payments empty it in the webhook, once the payment has
        // cleared, so a dismissed payment window leaves the basket intact.)
        if (isCod) await tx.cartItem.deleteMany({ where: { cart: { sessionId } } });

        // Shared rows last. The coupon and stock rows are what concurrent
        // checkouts queue for, and each is locked from its update until
        // COMMIT, so updating them at the end keeps that wait as short as it
        // can be.
        if (quote.appliedCouponCode) {
          const redeemed = await tx.coupon.updateMany({
            where: {
              code: quote.appliedCouponCode,
              OR: [{ maxUses: null }, { usedCount: { lt: db.coupon.fields.maxUses } }],
            },
            data: { usedCount: { increment: 1 } },
          });
          if (redeemed.count === 0) throw new CouponUsedUp();
        }

        const shortOf = await takeStock(tx, batchTakes);
        if (shortOf) throw new SoldOut(shortOf);

        return created;
      },
      // Explicit, not Prisma's 2 s / 5 s defaults, which failed a third of
      // orders when 20 shoppers checked out at once against a distant database.
      { maxWait: 10_000, timeout: 20_000 },
    )
    .catch((error: unknown) => {
      if (error instanceof SoldOut || error instanceof CouponUsedUp) return error;
      throw error;
    });

  if (order instanceof SoldOut) {
    return NextResponse.json(
      {
        message: "Some items in your basket can't be sent right now.",
        blocked: [{ name: order.productName, reason: "Just sold out while you were checking out." }],
      },
      { status: 409 },
    );
  }
  if (order instanceof CouponUsedUp) {
    return NextResponse.json(
      { message: "That discount code has just been used up. Remove it to place your order." },
      { status: 409 },
    );
  }

  // Stock just moved, so "Only N left" and availability must refresh.
  expireTag(CATALOG_TAG);

  // Analytics and the confirmation email run after the response is sent: the
  // order is already safely stored, and the shopper shouldn't wait on them.
  after(async () => {
    await recordOrderEvent(order.id, "PLACED", { type: "CUSTOMER", email: input.email }, {
      method: input.paymentMethod,
      totalPaise: quote.totalPaise,
    });
    // Proof of the optional marketing opt-in: who, when, where, and the exact
    // wording shown. Only a tick is recorded; no record means no consent.
    if (input.marketingConsent) {
      await db.consentRecord
        .create({
          data: {
            purpose: "MARKETING",
            granted: true,
            email: input.email,
            phone: input.phone,
            noticeText: MARKETING_CONSENT_TEXT,
            source: "checkout",
            orderId: order.id,
          },
        })
        .catch((error) => reportError("consent-record", error, { orderId: order.id }));
    }
    await recordEvent(sessionId, "ORDER_PLACED", {
      orderId: order.id,
      metadata: { totalPaise: quote.totalPaise, method: input.paymentMethod },
    });
    if (!isCod) return;
    // COD has no gateway to confirm a later capture, so — unlike RAZORPAY,
    // where ORDER_PAID waits for the signature-verified webhook — this is the
    // one path where the funnel's "paid" step means "order confirmed," not
    // "money verified."
    await recordEvent(sessionId, "ORDER_PAID", {
      orderId: order.id,
      metadata: { totalPaise: quote.totalPaise, method: "COD" },
    });
    // A COD order never reaches the Razorpay webhook, so its confirmation is
    // sent from here. sendOrderConfirmation swallows its own failures.
    const sent = await sendOrderConfirmation({ ...order, items: itemRows });
    await recordOrderEvent(order.id, "EMAIL_SENT", { type: "SYSTEM" }, {
      email: "order_confirmation",
      delivered: sent.delivered,
      reason: sent.reason ?? null,
    });
  });

  // --- Cash on delivery needs no gateway -----------------------------------
  if (isCod) {
    await writeBasketCount(0);
    return NextResponse.json({ orderNumber: order.orderNumber, accessToken: order.accessToken, method: "COD" });
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
    accessToken: order.accessToken,
    method: "RAZORPAY",
    razorpayOrderId: rzpOrder.id,
    keyId,
    amount: quote.totalPaise,
  });
}
