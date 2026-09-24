import "server-only";
import { unstable_cache } from "next/cache";
import { parsePostOffice, type PincodePlace } from "@/lib/checkout/pincode";

/**
 * India Post's city and state for a pincode (api.postalpincode.in), cached
 * per pincode for 30 days. Used by checkout autofill (/api/pincode/[pin])
 * and by create-order, which checks the delivery area against it rather than
 * trusting the typed state.
 *
 * An unknown pincode resolves to null and is cached; a network failure
 * throws and is not, so a blip doesn't stick for a month. Callers treat a
 * throw as "directory unavailable" and fall back to what was typed.
 */
export const lookupPincode = unstable_cache(
  async (pin: string): Promise<PincodePlace | null> => {
    const response = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`India Post lookup failed: ${response.status}`);
    return parsePostOffice(await response.json());
  },
  ["pincode-place"],
  { revalidate: 60 * 60 * 24 * 30 },
);
