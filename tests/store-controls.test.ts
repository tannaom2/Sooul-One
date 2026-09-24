import { describe, expect, it } from "vitest";
import { DEFAULT_CONTROLS, DEFAULT_PAUSE_MESSAGE, checkoutState } from "../src/lib/store-controls";

const open = { launchGateOpen: true, controls: DEFAULT_CONTROLS, onlinePayments: true };

describe("checkoutState", () => {
  it("offers online payment and cash on delivery when everything is on", () => {
    expect(checkoutState(open)).toEqual({ open: true, methods: ["ONLINE", "COD"] });
  });

  it("stays closed before launch, whatever the controls say", () => {
    const s = checkoutState({ ...open, launchGateOpen: false });
    expect(s.open).toBe(false);
    expect(!s.open && s.title).toBe("Opening soon");
  });

  it("shows the owner's message while orders are paused, or a sensible default", () => {
    const custom = checkoutState({ ...open, controls: { ...DEFAULT_CONTROLS, ordersPaused: true, pauseMessage: "Back on Monday after Diwali." } });
    expect(!custom.open && custom.message).toBe("Back on Monday after Diwali.");
    const blank = checkoutState({ ...open, controls: { ...DEFAULT_CONTROLS, ordersPaused: true, pauseMessage: "  " } });
    expect(!blank.open && blank.message).toBe(DEFAULT_PAUSE_MESSAGE);
  });

  it("drops cash on delivery when the owner switches it off", () => {
    expect(checkoutState({ ...open, controls: { ...DEFAULT_CONTROLS, codEnabled: false } })).toEqual({ open: true, methods: ["ONLINE"] });
  });

  it("closes rather than showing an empty payment step when no method is left", () => {
    const s = checkoutState({ ...open, onlinePayments: false, controls: { ...DEFAULT_CONTROLS, codEnabled: false } });
    expect(s.open).toBe(false);
  });

  it("is cash on delivery only until Razorpay is set up", () => {
    expect(checkoutState({ ...open, onlinePayments: false })).toEqual({ open: true, methods: ["COD"] });
  });
});
