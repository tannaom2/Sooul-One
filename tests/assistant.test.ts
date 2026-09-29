import { describe, expect, it } from "vitest";
import { MENU, classifyMessage, findOrderNumber, findPincode, parseContact, returnVerdict, whatsappLink } from "@/lib/assistant";

/** The storefront assistant's rules (src/lib/assistant.ts). */

const NOW = new Date("2026-09-29T06:30:00Z");
const DAY = 86_400_000;

describe("understanding what's typed", () => {
  it("finds order numbers, pincodes and contacts", () => {
    expect(findOrderNumber("where is so-muk6ctll-i2 please")).toBe("SO-MUK6CTLL-I2");
    expect(findOrderNumber("order 12345")).toBeNull();
    expect(findPincode("do you deliver to 395007?")).toBe("395007");
    expect(findPincode("call 9876543210")).toBeNull();
    expect(parseContact("+91 98765 43210")).toEqual({ phone: "9876543210" });
    expect(parseContact("09876543210")).toEqual({ phone: "9876543210" });
    expect(parseContact("Asha@Example.com")).toEqual({ email: "asha@example.com" });
    expect(parseContact("12345")).toBeNull();
    expect(parseContact("5876543210")).toBeNull(); // not an Indian mobile
  });

  it("classifies free-typed questions", () => {
    expect(classifyMessage("Where is my order?")).toBe("track");
    expect(classifyMessage("SO-MUK6CTLL-I2")).toBe("track");
    expect(classifyMessage("I want to return a damaged pack")).toBe("returns");
    expect(classifyMessage("is cash on delivery available")).toBe("cod");
    expect(classifyMessage("do you deliver to 380015")).toBe("pincode");
    expect(classifyMessage("380015")).toBe("pincode");
    expect(classifyMessage("how much is shipping")).toBe("shipping");
    expect(classifyMessage("can I pay by UPI")).toBe("payment");
    expect(classifyMessage("do you ship to Mumbai")).toBe("area");
    expect(classifyMessage("I want to talk to a person")).toBe("human");
    expect(classifyMessage("hello")).toBe("menu");
    expect(classifyMessage("asdfgh")).toBe("unknown");
  });
});

describe("returns, by the owner's rules only", () => {
  it("never judges without a window, and waits for delivery", () => {
    expect(returnVerdict({ status: "DELIVERED", deliveredAt: new Date(NOW.getTime() - 3 * DAY) }, null, NOW)).toEqual({ kind: "no-window" });
    expect(returnVerdict({ status: "SHIPPED", deliveredAt: null }, 7, NOW)).toEqual({ kind: "not-delivered", status: "SHIPPED" });
  });

  it("counts days from delivery against the window", () => {
    expect(returnVerdict({ status: "DELIVERED", deliveredAt: new Date(NOW.getTime() - 3 * DAY) }, 7, NOW)).toEqual({ kind: "within", daysLeft: 4 });
    expect(returnVerdict({ status: "DELIVERED", deliveredAt: new Date(NOW.getTime() - 7 * DAY) }, 7, NOW)).toEqual({ kind: "within", daysLeft: 0 });
    expect(returnVerdict({ status: "DELIVERED", deliveredAt: new Date(NOW.getTime() - 10 * DAY) }, 7, NOW)).toEqual({ kind: "outside", daysSince: 10 });
    expect(returnVerdict({ status: "RETURNED", deliveredAt: null }, 7, NOW)).toEqual({ kind: "closed", label: "already returned" });
  });
});

describe("handing over to a person", () => {
  it("builds a WhatsApp link with the order number, only for a valid number", () => {
    expect(whatsappLink("9876543210", "SO-MUK6CTLL-I2", "a return")).toBe(
      `https://wa.me/919876543210?text=${encodeURIComponent("Hi SooulOne, I need a return with order SO-MUK6CTLL-I2.")}`,
    );
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink("12345")).toBeNull();
  });

  it("always offers a person in the menu", () => {
    expect(MENU.some((m) => m.intent === "human")).toBe(true);
  });
});
