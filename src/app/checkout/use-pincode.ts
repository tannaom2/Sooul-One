"use client";

import { useEffect, useState } from "react";

export interface PincodeInfo {
  city?: string;
  state?: string;
  arrivesBy?: string;
  notFound?: boolean;
}

/**
 * Looks up city, state and the delivery estimate once a full pincode is
 * typed (via /api/pincode/[pin]). A failure simply returns nothing: the
 * shopper types city and state themselves, as before. Each result is kept
 * with the pincode it answers, so a stale answer is never shown for a new one.
 */
export function usePincode(pincode: string): PincodeInfo | null {
  const [result, setResult] = useState<{ pin: string; info: PincodeInfo | null } | null>(null);
  const valid = /^[1-9]\d{5}$/.test(pincode);

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    fetch(`/api/pincode/${pincode}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return setResult({ pin: pincode, info: { notFound: true } });
        setResult({ pin: pincode, info: response.ok ? ((await response.json()) as PincodeInfo) : null });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [pincode, valid]);

  return valid && result?.pin === pincode ? result.info : null;
}
