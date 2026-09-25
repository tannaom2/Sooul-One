import { NextResponse } from "next/server";
import { z } from "zod";
import { quoteCart, readSessionId } from "@/server/cart";
import { limitPublic } from "@/server/rate-limit";

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

  const result = await quoteCart(sessionId, parsed.data);
  if (!result) return NextResponse.json({ message: "Your basket is empty." }, { status: 400 });

  return NextResponse.json({
    quote: result.quote,
    estimatedDeliveryDate: result.estimatedDeliveryDate,
    couponRejected: result.couponRejected,
    couponMessage: result.couponMessage,
  });
}
