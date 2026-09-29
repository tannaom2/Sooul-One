import { NextResponse } from "next/server";
import { z } from "zod";
import { quoteCart, readSessionId } from "@/server/cart";
import { limitPublic } from "@/server/rate-limit";
import { getCustomer } from "@/server/customer-auth";
import { checkoutCredit, rememberedCode } from "@/server/referrals";
import { codForCheckout } from "@/server/intel";

const schema = z.object({
  pincode: z.string().regex(/^\d{6}$/).optional(),
  state: z.string().optional(),
  couponCode: z.string().max(40).optional(),
});

/** Live re-quote as the shopper types their address or applies a coupon. */
export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) return NextResponse.json({ message: "Your basket is empty." }, { status: 400 });
  const limited = await limitPublic("quote");
  if (limited) return limited;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: "Check the delivery pincode." }, { status: 400 });
  }

  const customer = await getCustomer();
  const { credit, note } = await checkoutCredit(customer?.id);
  const result = await quoteCart(sessionId, { ...parsed.data, credit });
  if (!result) return NextResponse.json({ message: "Your basket is empty." }, { status: 400 });
  // The owner's COD rules for this pincode and total (Analytics → Pincodes, Store controls).
  // A buyer's own history counts only for the signed-in shopper's proven number,
  // so nobody can ask this endpoint about someone else's number.
  const cod = await codForCheckout(parsed.data.pincode, result.quote.totalPaise, customer ? { customerId: customer.id, phone: customer.phone } : {});
  // A guest who arrived through a friend's link: signing in unlocks the offer.
  const friendCode = !customer ? await rememberedCode() : null;

  return NextResponse.json({
    quote: result.quote,
    estimatedDeliveryDate: result.estimatedDeliveryDate,
    couponRejected: result.couponRejected,
    couponMessage: result.couponMessage,
    creditNote: note,
    referralWaiting: Boolean(friendCode),
    cod: cod.allowed ? { allowed: true } : { allowed: false, message: cod.message },
  });
}
