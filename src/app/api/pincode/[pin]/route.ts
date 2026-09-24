import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { PINCODE, parsePostOffice, type PincodePlace } from "@/lib/checkout/pincode";
import { estimateDeliveryDate, zoneForPincode } from "@/lib/checkout/delivery";
import { reportError } from "@/lib/observability";

/**
 * City and state for a pincode, plus the delivery estimate, for checkout
 * autofill. Looked up server-side (the shopper's browser never calls India
 * Post, and only the pincode is sent) and cached per pincode for 30 days.
 * A slow or failed lookup answers 204 and the shopper types city and state
 * as before; nothing about checkout depends on this succeeding.
 */

const lookup = unstable_cache(
  async (pin: string): Promise<PincodePlace | null> => {
    const response = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`India Post lookup failed: ${response.status}`);
    // An unknown pincode resolves to null and is cached; a network failure
    // throws and is not, so a blip doesn't stick for a month.
    return parsePostOffice(await response.json());
  },
  ["pincode-place"],
  { revalidate: 60 * 60 * 24 * 30 },
);

export async function GET(_request: Request, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  if (!PINCODE.test(pin)) return NextResponse.json({ message: "Enter a 6-digit pincode." }, { status: 400 });

  const arrivesBy = estimateDeliveryDate(new Date(), zoneForPincode(pin)).toISOString();
  try {
    const place = await lookup(pin);
    if (!place) return NextResponse.json({ message: "We couldn't find that pincode. Check it, or type the city and state." }, { status: 404 });
    return NextResponse.json({ ...place, arrivesBy });
  } catch (error) {
    reportError("pincode-lookup", error, { pin });
    return NextResponse.json({ arrivesBy }, { status: 200 });
  }
}
