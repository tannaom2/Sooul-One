import { NextResponse, after } from "next/server";
import { PINCODE } from "@/lib/checkout/pincode";
import { estimateDeliveryDate, zoneForPincode } from "@/lib/checkout/delivery";
import { OUTSIDE_AREA_MESSAGE, isServiceable } from "@/lib/checkout/service-area";
import { lookupPincode } from "@/server/pincode";
import { reportError } from "@/lib/observability";
import { limitPublic } from "@/server/rate-limit";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { extraDeliveryDays } from "@/server/intel";

/**
 * Every pincode typed at checkout is recorded (pincode and whether we
 * deliver there, nothing else), so Analytics → Pincodes can show where demand
 * comes from, including from outside the delivery area.
 */
async function recordCheck(pin: string, serviceable: boolean) {
  const sessionId = await readSessionId();
  if (sessionId) after(() => recordEvent(sessionId, "PINCODE_CHECKED", { metadata: { pincode: pin, serviceable } }));
}

/**
 * City, state and delivery estimate for a pincode, for checkout autofill,
 * plus whether we deliver there. Looked up server-side (the shopper's
 * browser never calls India Post, and only the pincode is sent). A slow or
 * failed lookup still answers, and the shopper types city and state as
 * before; create-order makes the final delivery-area check.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  if (!PINCODE.test(pin)) return NextResponse.json({ message: "Enter a 6-digit pincode." }, { status: 400 });
  const limited = await limitPublic("pincode");
  if (limited) return limited;

  const extra = await extraDeliveryDays(pin);
  const arrivesBy = new Date(estimateDeliveryDate(new Date(), zoneForPincode(pin)).getTime() + extra * 24 * 60 * 60 * 1000).toISOString();
  try {
    const place = await lookupPincode(pin);
    if (!place) return NextResponse.json({ message: "We couldn't find that pincode. Check it, or type the city and state." }, { status: 404 });
    const serviceable = isServiceable(pin, place.state, place.state);
    await recordCheck(pin, serviceable);
    return NextResponse.json({ ...place, serviceable, arrivesBy: serviceable ? arrivesBy : undefined, message: serviceable ? undefined : OUTSIDE_AREA_MESSAGE });
  } catch (error) {
    reportError("pincode-lookup", error, { pin });
    return NextResponse.json({ serviceable: isServiceable(pin, "Gujarat"), arrivesBy }, { status: 200 });
  }
}
