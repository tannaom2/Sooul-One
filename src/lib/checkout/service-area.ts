/**
 * Where SooulOne delivers. For now: Gujarat only (owner decision, 25 Sept
 * 2026). Change it here and everything follows: checkout validation, the
 * server-side order check, delivery estimates and the storefront messages.
 *
 * Two conditions, because pincode prefixes alone aren't exact: Gujarat
 * pincodes start 36–39, but some 396xxx pincodes belong to Dadra & Nagar
 * Haveli and Daman & Diu. So the state must be Gujarat as well, and the
 * server checks that against India Post's record of the pincode rather than
 * trusting what was typed. Pure, so it's tested directly.
 */

export const SERVICE_AREA = {
  /** How the storefront names the area: "Delivering across Gujarat". */
  label: "Gujarat",
  states: ["gujarat"],
  pincodePrefixes: ["36", "37", "38", "39"],
} as const;

export const OUTSIDE_AREA_MESSAGE = `We deliver only within ${SERVICE_AREA.label} for now.`;

const normalState = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function inServicePincode(pincode: string): boolean {
  return /^\d{6}$/.test(pincode) && SERVICE_AREA.pincodePrefixes.some((p) => pincode.startsWith(p));
}

export function inServiceState(state: string): boolean {
  return (SERVICE_AREA.states as readonly string[]).includes(normalState(state));
}

/**
 * Whether an address is deliverable. `directoryState` is India Post's state
 * for the pincode when known; it overrides the typed state, so typing
 * "Gujarat" next to an out-of-area pincode doesn't get through.
 */
export function isServiceable(pincode: string, typedState: string, directoryState?: string | null): boolean {
  if (!inServicePincode(pincode)) return false;
  return inServiceState(directoryState ?? typedState);
}
