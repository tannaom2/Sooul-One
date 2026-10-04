import { describe, expect, it } from "vitest";
import { mergedQuantity, planSignInBasket } from "@/lib/basket-sign-in";

/** The basket follows the account across devices, but never into an order at checkout. */

const ME = "cust_me";

describe("signing in from the sign-in page", () => {
  it("makes this browser's basket the account's when the account has none", () => {
    expect(planSignInBasket({ id: "guest", customerId: null }, null, ME, "follow")).toEqual({ kind: "claim", cartId: "guest" });
    expect(planSignInBasket(null, null, ME, "follow")).toEqual({ kind: "none" });
  });

  it("brings this browser's basket into the account's, then uses the account's here", () => {
    expect(planSignInBasket({ id: "guest", customerId: null }, { id: "mine" }, ME, "follow")).toEqual({ kind: "merge", from: "guest", into: "mine" });
    expect(planSignInBasket(null, { id: "mine" }, ME, "follow")).toEqual({ kind: "use", cartId: "mine" });
    expect(planSignInBasket({ id: "mine", customerId: ME }, { id: "mine" }, ME, "follow")).toEqual({ kind: "none" });
  });

  it("never merges someone else's basket left on a shared computer", () => {
    expect(planSignInBasket({ id: "theirs", customerId: "cust_other" }, { id: "mine" }, ME, "follow")).toEqual({ kind: "use", cartId: "mine" });
    expect(planSignInBasket({ id: "theirs", customerId: "cust_other" }, null, ME, "follow")).toEqual({ kind: "fresh" });
  });
});

describe("proving the number at checkout", () => {
  it("leaves the basket being checked out exactly as it is", () => {
    expect(planSignInBasket({ id: "guest", customerId: null }, { id: "mine" }, ME, "keep")).toEqual({ kind: "none" });
    expect(planSignInBasket(null, { id: "mine" }, ME, "keep")).toEqual({ kind: "none" });
    expect(planSignInBasket({ id: "theirs", customerId: "cust_other" }, null, ME, "keep")).toEqual({ kind: "none" });
  });

  it("still links it to the account when the account has no basket yet", () => {
    expect(planSignInBasket({ id: "guest", customerId: null }, null, ME, "keep")).toEqual({ kind: "claim", cartId: "guest" });
  });
});

describe("a product in both baskets", () => {
  it("adds the quantities, within the 20 per line limit", () => {
    expect(mergedQuantity(2, 3)).toBe(5);
    expect(mergedQuantity(15, 9)).toBe(20);
  });
});
