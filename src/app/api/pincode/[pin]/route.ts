import { NextResponse } from "next/server";
import { PINCODE } from "@/lib/checkout/pincode";
import { estimateDeliveryDate, zoneForPincode } from "@/lib/checkout/delivery";
import { OUTSIDE_AREA_MESSAGE, isServiceable } from "@/lib/checkout/service-area";
import { lookupPincode } from "@/server/pincode";
import { reportError } from "@/lib/observability";

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

  const arrivesBy = estimateDeliveryDate(new Date(), zoneForPincode(pin)).toISOString();
  try {
    const place = await lookupPincode(pin);
    if (!place) return NextResponse.json({ message: "We couldn't find that pincode. Check it, or type the city and state." }, { status: 404 });
    const serviceable = isServiceable(pin, place.state, place.state);
    return NextResponse.json({ ...place, serviceable, arrivesBy: serviceable ? arrivesBy : undefined, message: serviceable ? undefined : OUTSIDE_AREA_MESSAGE });
  } catch (error) {
    reportError("pincode-lookup", error, { pin });
    return NextResponse.json({ serviceable: isServiceable(pin, "Gujarat"), arrivesBy }, { status: 200 });
  }
}
