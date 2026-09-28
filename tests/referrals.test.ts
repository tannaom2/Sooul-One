import { describe, expect, it } from "vitest";
import {
  attributionBlock,
  canMove,
  cleanCode,
  creditOffer,
  friendLabel,
  makeReferralCode,
  milestoneFor,
  normaliseAddress,
  overMonthlyBudget,
  referralAfter,
  riskScore,
  type AttributionFacts,
} from "../src/lib/referrals";
import { allocate, parseAllocations, walletState, type LedgerEntry } from "../src/lib/wallet";

const NOW = new Date("2026-09-28T10:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("referral stages", () => {
  it("follow the order: placed, delivered, then held for the return window", () => {
    expect(referralAfter("ATTRIBUTED", "PLACED")).toEqual({ to: "QUALIFYING" });
    expect(referralAfter("QUALIFYING", "DELIVERED")).toEqual({ to: "HELD" });
    expect(canMove("HELD", "REWARDED")).toBe(true);
  });

  it("a cancelled first order puts the friend back, so they can order again", () => {
    expect(referralAfter("QUALIFYING", "CANCELLED")).toEqual({ to: "ATTRIBUTED" });
  });

  it("an undelivered or returned first order ends the referral", () => {
    expect(referralAfter("QUALIFYING", "RTO")).toEqual({ to: "VOID", reason: "first_order_not_delivered" });
    expect(referralAfter("HELD", "RETURNED")).toEqual({ to: "VOID", reason: "first_order_returned" });
  });

  it("later orders and finished referrals are left alone", () => {
    expect(referralAfter("REWARDED", "RETURNED")).toBeNull();
    expect(referralAfter("HELD", "PLACED")).toBeNull();
    expect(canMove("REWARDED", "VOID")).toBe(false);
    expect(milestoneFor("SHIPPED")).toBeNull();
    expect(milestoneFor("RTO")).toBe("RTO");
  });
});

describe("referral codes", () => {
  it("start with the name and avoid characters that get misread", () => {
    const code = makeReferralCode("Asha Patel", () => 0.99);
    expect(code).toMatch(/^ASHA[A-Z2-9]{3}$/);
    expect(makeReferralCode("", () => 0)).toMatch(/^SOUL/);
    expect(makeReferralCode("Ó'Neil", () => 0)).toMatch(/^ONEI/);
  });

  it("tidy what was typed or pasted", () => {
    expect(cleanCode(" asha-7k2 ")).toBe("ASHA7K2");
    expect(cleanCode("ab")).toBeNull();
  });
});

describe("who can be a referred friend", () => {
  const ok: AttributionFacts = {
    programmeActive: true,
    codeFound: true,
    codeActive: true,
    refereeIsReferrer: false,
    refereeAlreadyReferred: false,
    refereeHasReferred: false,
    refereePriorOrders: 0,
    rewardsIssued: 2,
    maxRewards: 5,
    refereeDiscountAfterCap: false,
  };

  it("a genuinely new customer with a live code", () => expect(attributionBlock(ok)).toBeNull());

  it("never yourself, never twice, never someone who has ordered before", () => {
    expect(attributionBlock({ ...ok, refereeIsReferrer: true })).toBe("OWN_CODE");
    expect(attributionBlock({ ...ok, refereeAlreadyReferred: true })).toBe("ALREADY_REFERRED");
    expect(attributionBlock({ ...ok, refereePriorOrders: 1 })).toBe("NOT_NEW_CUSTOMER");
    expect(attributionBlock({ ...ok, refereePriorOrders: 1 })).toBe("NOT_NEW_CUSTOMER");
  });

  it("never someone who already invites friends: no A → B → A loop", () => {
    // A signed up and referred B without ever ordering; B then tries to refer A.
    expect(attributionBlock({ ...ok, refereeHasReferred: true })).toBe("ALREADY_A_REFERRER");
  });

  it("stops at the cap unless the owner lets friends keep their discount", () => {
    expect(attributionBlock({ ...ok, rewardsIssued: 5 })).toBe("CAP_REACHED");
    expect(attributionBlock({ ...ok, rewardsIssued: 5, refereeDiscountAfterCap: true })).toBeNull();
  });
});

describe("credit offered at checkout", () => {
  const rules = { isActive: true, refereeRewardPaise: 10000, minOrderPaise: 79900, maxCreditPerOrderPaise: 10000 };

  it("a friend's first order gets the welcome discount", () => {
    expect(creditOffer(rules, { welcomePending: true, walletAvailablePaise: 0 })).toEqual({ kind: "WELCOME", amountPaise: 10000, minOrderPaise: 79900 });
  });

  it("a referrer with ₹500 saved spends at most ₹100 per order", () => {
    expect(creditOffer(rules, { welcomePending: false, walletAvailablePaise: 50000 })).toEqual({ kind: "WALLET", amountPaise: 10000, minOrderPaise: 79900 });
    expect(creditOffer(rules, { welcomePending: false, walletAvailablePaise: 4000 })?.amountPaise).toBe(4000);
  });

  it("nothing when the programme is off or the wallet is empty", () => {
    expect(creditOffer({ ...rules, isActive: false }, { welcomePending: true, walletAvailablePaise: 50000 })).toBeNull();
    expect(creditOffer(rules, { welcomePending: false, walletAvailablePaise: 0 })).toBeNull();
  });
});

describe("abuse signals", () => {
  it("add up, with the address weighing most", () => {
    expect(riskScore({ sameDevice: false, sameAddress: false, sameEmail: false, referralsLast24h: 1 }).score).toBe(0);
    const risky = riskScore({ sameDevice: true, sameAddress: true, sameEmail: false, referralsLast24h: 5 });
    expect(risky.score).toBe(120);
    expect(risky.reasons).toHaveLength(3);
  });

  it("match an address however it was typed", () => {
    expect(normaliseAddress({ line1: "D-502, Shilp Apts.", postalCode: "364003" })).toBe(
      normaliseAddress({ line1: "d502 shilp apartments", postalCode: "364 003" }),
    );
    expect(normaliseAddress({ line1: "D-502, Shilp Apts.", postalCode: "364003" })).not.toBe(normaliseAddress({ line1: "D-503, Shilp Apts.", postalCode: "364003" }));
  });

  it("hold rewards that would pass the monthly budget", () => {
    expect(overMonthlyBudget(490000, 10000, 500000)).toBe(false);
    expect(overMonthlyBudget(495000, 10000, 500000)).toBe(true);
    expect(overMonthlyBudget(10 ** 9, 10000, null)).toBe(false);
  });

  it("show the referrer a friend's first name and initial only", () => {
    expect(friendLabel("Mansi Nair")).toBe("Mansi N.");
    expect(friendLabel("")).toBe("A friend");
  });
});

describe("the wallet ledger", () => {
  const credit = (id: string, rupees: number, expiresInDays: number): LedgerEntry => ({
    id,
    kind: "REFERRAL_CREDIT",
    amountPaise: rupees * 100,
    expiresAt: days(expiresInDays),
    allocations: null,
    createdAt: NOW,
  });

  it("adds up unexpired credits, soonest-expiring first", () => {
    const s = walletState([credit("a", 100, 90), credit("b", 100, 10), credit("old", 100, -1)], NOW);
    expect(s.availablePaise).toBe(20000);
    expect(s.credits.map((c) => c.id)).toEqual(["b", "a"]);
    expect(s.nextExpiry?.id).toBe("b");
  });

  it("spends the soonest-expiring credit first and refuses to overspend", () => {
    const entries = [credit("a", 100, 90), credit("b", 100, 10)];
    expect(allocate(entries, 10000, NOW)).toEqual([{ creditId: "b", paise: 10000 }]);
    expect(allocate(entries, 15000, NOW)).toEqual([{ creditId: "b", paise: 10000 }, { creditId: "a", paise: 5000 }]);
    expect(allocate(entries, 30000, NOW)).toBeNull();
  });

  it("a refund puts back exactly the credit a cancelled order used", () => {
    const spent: LedgerEntry = { id: "r1", kind: "ORDER_REDEMPTION", amountPaise: -10000, expiresAt: null, allocations: [{ creditId: "b", paise: 10000 }], createdAt: NOW };
    const refund: LedgerEntry = { id: "r2", kind: "REDEMPTION_REFUND", amountPaise: 10000, expiresAt: null, allocations: [{ creditId: "b", paise: 10000 }], createdAt: NOW };
    const base = [credit("a", 100, 90), credit("b", 100, 10)];
    expect(walletState([...base, spent], NOW).availablePaise).toBe(10000);
    expect(walletState([...base, spent, refund], NOW).credits.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("reads stored allocations defensively", () => {
    expect(parseAllocations([{ creditId: "a", paise: 100 }, { nope: 1 }])).toEqual([{ creditId: "a", paise: 100 }]);
    expect(parseAllocations(null)).toEqual([]);
  });
});
