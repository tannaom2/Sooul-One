/**
 * What checkout can offer right now, from the launch gate, the owner's store
 * controls (Settings → Store controls) and whether online payment is set up.
 * The checkout page and create-order both ask this, so the page never offers
 * what the server would refuse. Pure, so it's tested directly.
 */

export interface StoreControls {
  readonly ordersPaused: boolean;
  readonly pauseMessage: string | null;
  readonly codEnabled: boolean;
  readonly bundlesEnabled: boolean;
}

export const DEFAULT_CONTROLS: StoreControls = {
  ordersPaused: false,
  pauseMessage: null,
  codEnabled: true,
  bundlesEnabled: true,
};

export type PaymentMethod = "COD" | "ONLINE";

export type CheckoutState =
  | { readonly open: true; readonly methods: readonly PaymentMethod[] }
  | { readonly open: false; readonly title: string; readonly message: string };

export const DEFAULT_PAUSE_MESSAGE = "We've paused orders for a short while. Your basket is saved, so check back soon.";

export function checkoutState(input: {
  readonly launchGateOpen: boolean;
  readonly controls: StoreControls;
  readonly onlinePayments: boolean;
}): CheckoutState {
  if (!input.launchGateOpen) {
    return { open: false, title: "Opening soon", message: "We're not taking orders just yet. Your basket is saved, so check back soon." };
  }
  if (input.controls.ordersPaused) {
    return { open: false, title: "Orders paused", message: input.controls.pauseMessage?.trim() || DEFAULT_PAUSE_MESSAGE };
  }
  const methods: PaymentMethod[] = [];
  if (input.onlinePayments) methods.push("ONLINE");
  if (input.controls.codEnabled) methods.push("COD");
  if (methods.length === 0) {
    // Cash on delivery switched off with no online payment set up: nothing to pay with.
    return { open: false, title: "Orders paused", message: DEFAULT_PAUSE_MESSAGE };
  }
  return { open: true, methods };
}
