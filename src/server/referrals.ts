import "server-only";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decimalToPaise } from "@/lib/format";
import { fromPaise } from "@/lib/money";
import type { QuoteCredit } from "@/lib/checkout/quote";
import {
  BLOCK_MESSAGES,
  attributionBlock,
  cleanCode,
  creditOffer,
  friendLabel,
  makeReferralCode,
  milestoneFor,
  normaliseAddress,
  overMonthlyBudget,
  referralAfter,
  riskScore,
  type ReferralStatus,
} from "@/lib/referrals";
import { allocate, parseAllocations, walletState, type LedgerEntry } from "@/lib/wallet";
import { asAddress } from "@/lib/stored-order";

/**
 * Referrals, the database side. The rules are in src/lib/referrals.ts and the
 * wallet arithmetic in src/lib/wallet.ts; this file only reads, decides with
 * them, and writes, inside transactions where money moves.
 */

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export const REF_COOKIE = "soulone_ref";
const REF_COOKIE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** "Mansi" from "Mansi Nair"; the fallback, whole, when there's no name. */
const firstName = (name: string | null | undefined, fallback: string) => name?.trim().split(/\s+/)[0] || fallback;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// --------------------------------------------------------------------------
// Programme
// --------------------------------------------------------------------------

export interface Program {
  readonly isActive: boolean;
  readonly referrerRewardPaise: number;
  readonly refereeRewardPaise: number;
  readonly minOrderPaise: number;
  readonly maxCreditPerOrderPaise: number;
  readonly maxRewardsPerReferrer: number;
  readonly holdDays: number;
  readonly attributionDays: number;
  readonly creditExpiryDays: number;
  readonly refereeDiscountAfterCap: boolean;
  readonly riskThreshold: number;
  readonly monthlyBudgetPaise: number | null;
}

/** The owner's rules; off, with the recommended defaults, until they're saved once. */
export async function getProgram(client: Tx | typeof db = db): Promise<Program> {
  const row = await client.referralProgram.findUnique({ where: { id: "default" } });
  return {
    isActive: row?.isActive ?? false,
    referrerRewardPaise: decimalToPaise(row?.referrerReward ?? 100),
    refereeRewardPaise: decimalToPaise(row?.refereeReward ?? 100),
    minOrderPaise: decimalToPaise(row?.minOrderValue ?? 799),
    maxCreditPerOrderPaise: decimalToPaise(row?.maxCreditPerOrder ?? 100),
    maxRewardsPerReferrer: row?.maxRewardsPerReferrer ?? 5,
    holdDays: row?.holdDays ?? 7,
    attributionDays: row?.attributionDays ?? 30,
    creditExpiryDays: row?.creditExpiryDays ?? 180,
    refereeDiscountAfterCap: row?.refereeDiscountAfterCap ?? false,
    riskThreshold: row?.riskThreshold ?? 50,
    monthlyBudgetPaise: row?.monthlyBudget == null ? null : decimalToPaise(row.monthlyBudget),
  };
}

// --------------------------------------------------------------------------
// Codes, links and the referral cookie
// --------------------------------------------------------------------------

/** The customer's own code, made the first time they ask for it. */
export async function ensureReferralCode(customerId: string): Promise<string> {
  const existing = await db.referralCode.findUnique({ where: { customerId } });
  if (existing) return existing.code;
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId }, select: { name: true } });
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeReferralCode(customer.name, Math.random);
    try {
      const created = await db.referralCode.create({ data: { customerId, code } });
      return created.code;
    } catch {
      // Two people named Asha drew the same three characters: draw again.
    }
  }
  throw new Error("Couldn't make a referral code.");
}

/** Remember a friend's code in this browser until they sign in. Route handlers and actions only. */
export async function rememberCode(code: string): Promise<void> {
  (await cookies()).set(REF_COOKIE, code, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REF_COOKIE_DAYS * 24 * 60 * 60,
  });
}

export async function rememberedCode(): Promise<string | null> {
  return cleanCode((await cookies()).get(REF_COOKIE)?.value);
}

export async function forgetCode(): Promise<void> {
  (await cookies()).delete(REF_COOKIE);
}

/** For the invite page: whose link this is and what it's worth. Null when it isn't a live code. */
export async function invite(code: string): Promise<{ code: string; referrer: string; refereeRewardPaise: number; minOrderPaise: number } | null> {
  const clean = cleanCode(code);
  if (!clean) return null;
  const [program, row] = await Promise.all([getProgram(), db.referralCode.findUnique({ where: { code: clean }, include: { customer: { select: { name: true } } } })]);
  if (!program.isActive || !row || !row.isActive) return null;
  if (row.timesRedeemed >= program.maxRewardsPerReferrer && !program.refereeDiscountAfterCap) return null;
  return {
    code: row.code,
    referrer: firstName(row.customer.name, "A friend"),
    refereeRewardPaise: program.refereeRewardPaise,
    minOrderPaise: program.minOrderPaise,
  };
}

// --------------------------------------------------------------------------
// Attribution: a new customer arrives through a code
// --------------------------------------------------------------------------

export async function attributeReferral(input: {
  refereeId: string;
  code: string;
  via: "LINK" | "CODE";
  /** SHA-256 of this browser's basket-session id. */
  deviceHash: string | null;
}): Promise<{ ok: true; referrer: string } | { ok: false; message: string }> {
  const code = cleanCode(input.code);
  const [program, codeRow, referee, existing] = await Promise.all([
    getProgram(),
    code ? db.referralCode.findUnique({ where: { code }, include: { customer: { select: { id: true, name: true } } } }) : null,
    db.customer.findUnique({ where: { id: input.refereeId }, select: { id: true, phone: true } }),
    db.referral.findUnique({ where: { refereeId: input.refereeId } }),
  ]);
  if (!referee) return { ok: false, message: BLOCK_MESSAGES.UNKNOWN_CODE };
  const [priorOrders, referralsMade] = await Promise.all([
    db.order.count({
      where: { OR: [{ customerId: referee.id }, ...(referee.phone ? [{ guestPhone: referee.phone }] : [])] },
    }),
    db.referral.count({ where: { referrerId: referee.id } }),
  ]);

  const block = attributionBlock({
    programmeActive: program.isActive,
    codeFound: Boolean(codeRow),
    codeActive: codeRow?.isActive ?? false,
    refereeIsReferrer: codeRow?.customerId === referee.id,
    refereeAlreadyReferred: Boolean(existing),
    refereeHasReferred: referralsMade > 0,
    refereePriorOrders: priorOrders,
    rewardsIssued: codeRow?.timesRedeemed ?? 0,
    maxRewards: program.maxRewardsPerReferrer,
    refereeDiscountAfterCap: program.refereeDiscountAfterCap,
  });
  if (block || !codeRow) return { ok: false, message: BLOCK_MESSAGES[block ?? "UNKNOWN_CODE"] };

  const [sameDevice, recent] = await Promise.all([
    input.deviceHash ? db.customerSession.count({ where: { customerId: codeRow.customerId, deviceHash: input.deviceHash } }) : 0,
    db.referral.count({ where: { referrerId: codeRow.customerId, attributedAt: { gte: new Date(Date.now() - DAY) } } }),
  ]);
  const risk = riskScore({ sameDevice: sameDevice > 0, sameAddress: false, sameEmail: false, referralsLast24h: recent + 1 });

  try {
    await db.referral.create({
      data: {
        codeId: codeRow.id,
        referrerId: codeRow.customerId,
        refereeId: referee.id,
        via: input.via,
        riskScore: risk.score,
        riskSignals: { atSignUp: risk.reasons },
        flagged: risk.score >= program.riskThreshold,
        events: { create: { toStatus: "ATTRIBUTED", actor: "SYSTEM", detail: { via: input.via, reasons: risk.reasons } } },
      },
    });
  } catch {
    // Referred a moment ago in another tab (refereeId is unique).
    return { ok: false, message: BLOCK_MESSAGES.ALREADY_REFERRED };
  }
  return { ok: true, referrer: firstName(codeRow.customer.name, "your friend") };
}

// --------------------------------------------------------------------------
// Money off at checkout
// --------------------------------------------------------------------------

async function ledger(customerId: string, client: Tx | typeof db = db): Promise<LedgerEntry[]> {
  const rows = await client.walletEntry.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    amountPaise: decimalToPaise(r.amount),
    expiresAt: r.expiresAt,
    allocations: parseAllocations(r.allocations),
    createdAt: r.createdAt,
  }));
}

/** A referred friend whose first order is still to come, within the window. */
async function welcomePending(customerId: string, program: Program): Promise<{ referrer: string } | null> {
  const referral = await db.referral.findUnique({
    where: { refereeId: customerId },
    include: { referrer: { select: { name: true } } },
  });
  if (!referral || referral.status !== "ATTRIBUTED") return null;
  if (referral.attributedAt.getTime() + program.attributionDays * DAY < Date.now()) return null;
  return { referrer: firstName(referral.referrer.name, "a friend") };
}

export interface CheckoutCredit {
  readonly credit: QuoteCredit | null;
  /** Shown at checkout: whose welcome offer, or how much credit is saved. */
  readonly note: string | null;
}

/** The credit this signed-in shopper can use on this order (the quote decides if it applies). */
export async function checkoutCredit(customerId: string | null | undefined): Promise<CheckoutCredit> {
  if (!customerId) return { credit: null, note: null };
  const program = await getProgram();
  if (!program.isActive) return { credit: null, note: null };
  const [welcome, entries] = await Promise.all([welcomePending(customerId, program), ledger(customerId)]);
  const wallet = walletState(entries, new Date());
  const credit = creditOffer(
    { isActive: program.isActive, refereeRewardPaise: program.refereeRewardPaise, minOrderPaise: program.minOrderPaise, maxCreditPerOrderPaise: program.maxCreditPerOrderPaise },
    { welcomePending: Boolean(welcome), walletAvailablePaise: wallet.availablePaise },
  );
  if (!credit) return { credit: null, note: null };
  const note =
    credit.kind === "WELCOME" ? `Welcome offer from ${welcome!.referrer}` : `Referral credit (${fromPaiseTag(wallet.availablePaise)} saved)`;
  return { credit, note };
}

const fromPaiseTag = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export class CreditChanged extends Error {}

/**
 * Inside the order's transaction: spend the wallet credit the quote took off
 * (oldest-expiring first, recorded against those credits), and move the
 * friend's referral on if this first order is big enough to count.
 */
export async function onOrderPlaced(
  tx: Tx,
  order: { id: string; customerId: string | null; creditPaise: number; creditKind: "WALLET" | "WELCOME" | null; valueAfterOffersPaise: number },
): Promise<void> {
  if (!order.customerId) return;
  if (order.creditKind === "WALLET" && order.creditPaise > 0) {
    // One checkout at a time per wallet: the row lock holds a second one until this commits.
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${order.customerId} FOR UPDATE`;
    const allocations = allocate(await ledger(order.customerId, tx), order.creditPaise, new Date());
    if (!allocations) throw new CreditChanged("Your referral credit changed while you were checking out.");
    await tx.walletEntry.create({
      data: {
        customerId: order.customerId,
        amount: fromPaise(-order.creditPaise),
        kind: "ORDER_REDEMPTION",
        orderId: order.id,
        allocations: allocations as unknown as Prisma.InputJsonValue,
      },
    });
  }

  const program = await getProgram(tx);
  const referral = await tx.referral.findUnique({ where: { refereeId: order.customerId } });
  if (!referral || referral.status !== "ATTRIBUTED") return;
  // Only a first order over the minimum counts; a smaller one leaves the friend
  // free to qualify with their next.
  if (order.valueAfterOffersPaise < program.minOrderPaise) return;
  await moveReferral(tx, referral.id, referral.status, "QUALIFYING", "SYSTEM", { orderId: order.id }, { qualifyingOrderId: order.id });
}

async function moveReferral(
  tx: Tx,
  id: string,
  from: ReferralStatus,
  to: ReferralStatus,
  actor: string,
  detail: Record<string, unknown>,
  data: Prisma.ReferralUpdateManyMutationInput = {},
): Promise<boolean> {
  const { count } = await tx.referral.updateMany({ where: { id, status: from }, data: { ...data, status: to } });
  if (count === 0) return false;
  await tx.referralEvent.create({ data: { referralId: id, fromStatus: from, toStatus: to, actor, detail: detail as Prisma.InputJsonValue } });
  return true;
}

/**
 * Inside the status change's transaction: give back wallet credit an order
 * that won't complete had spent, and move the friend's referral on.
 */
export async function onOrderStatusChanged(tx: Tx, orderId: string, toStatus: string, actor: string): Promise<void> {
  if (["CANCELLED", "RTO", "RETURNED", "REFUNDED"].includes(toStatus)) {
    const spent = await tx.walletEntry.findUnique({ where: { kind_orderId: { kind: "ORDER_REDEMPTION", orderId } } });
    if (spent) {
      await tx.walletEntry.upsert({
        where: { kind_orderId: { kind: "REDEMPTION_REFUND", orderId } },
        create: {
          customerId: spent.customerId,
          amount: fromPaise(-decimalToPaise(spent.amount)),
          kind: "REDEMPTION_REFUND",
          orderId,
          allocations: spent.allocations ?? undefined,
          note: `Order ${toStatus.toLowerCase()}`,
        },
        update: {},
      });
    }
  }

  const milestone = milestoneFor(toStatus);
  if (!milestone) return;
  const referral = await tx.referral.findUnique({ where: { qualifyingOrderId: orderId } });
  if (!referral) return;
  const next = referralAfter(referral.status, milestone);
  if (!next) return;

  if (next.to === "HELD") {
    const program = await getProgram(tx);
    const risk = await orderRisk(tx, referral, orderId);
    const reasons = [...((referral.riskSignals as { atSignUp?: string[] } | null)?.atSignUp ?? []), ...risk.reasons];
    const score = referral.riskScore + risk.score;
    await moveReferral(tx, referral.id, referral.status, "HELD", actor, { orderStatus: toStatus, reasons: risk.reasons }, {
      holdUntil: new Date(Date.now() + program.holdDays * DAY),
      riskScore: score,
      riskSignals: { atSignUp: (referral.riskSignals as { atSignUp?: string[] } | null)?.atSignUp ?? [], atDelivery: risk.reasons, all: reasons },
      flagged: referral.flagged || score >= program.riskThreshold,
    });
  } else if (next.to === "ATTRIBUTED") {
    await moveReferral(tx, referral.id, referral.status, "ATTRIBUTED", actor, { orderStatus: toStatus }, { qualifyingOrderId: null });
  } else {
    await moveReferral(tx, referral.id, referral.status, next.to, actor, { orderStatus: toStatus }, { voidReason: next.reason ?? null });
  }
}

/** Signals from the first order itself: the referrer's address or email. */
async function orderRisk(tx: Tx, referral: { referrerId: string; refereeId: string }, orderId: string) {
  const [order, referrerOrders] = await Promise.all([
    tx.order.findUnique({ where: { id: orderId }, select: { shippingAddress: true, guestEmail: true } }),
    tx.order.findMany({ where: { customerId: referral.referrerId }, select: { shippingAddress: true, guestEmail: true }, take: 50 }),
  ]);
  if (!order) return { score: 0, reasons: [] as string[] };
  const address = normaliseAddress(asAddress(order.shippingAddress));
  const sameAddress = referrerOrders.some((o) => normaliseAddress(asAddress(o.shippingAddress)) === address);
  const email = order.guestEmail?.trim().toLowerCase();
  const sameEmail = Boolean(email) && referrerOrders.some((o) => o.guestEmail?.trim().toLowerCase() === email);
  return riskScore({ sameDevice: false, sameAddress, sameEmail, referralsLast24h: 0 });
}

// --------------------------------------------------------------------------
// Rewards
// --------------------------------------------------------------------------

export type RewardResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Pay a held referral: raise the referrer's reward count only while it's under
 * the cap, credit their wallet (once per referral, by a unique key), and mark
 * it rewarded, all in one transaction. The monthly budget holds the reward for
 * review instead, unless an admin is approving it by hand.
 */
export async function rewardReferral(id: string, actor: string, { override = false } = {}): Promise<RewardResult> {
  return db.$transaction(async (tx) => {
    const program = await getProgram(tx);
    const referral = await tx.referral.findUnique({ where: { id } });
    if (!referral || referral.status !== "HELD") return { ok: false, message: "Only a held referral can be paid." };

    if (!override) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const issued = await tx.walletEntry.aggregate({ where: { kind: "REFERRAL_CREDIT", createdAt: { gte: monthStart } }, _sum: { amount: true } });
      if (overMonthlyBudget(decimalToPaise(issued._sum.amount ?? 0), program.referrerRewardPaise, program.monthlyBudgetPaise)) {
        await tx.referral.update({ where: { id }, data: { flagged: true } });
        await tx.referralEvent.create({ data: { referralId: id, fromStatus: "HELD", toStatus: "HELD", actor, detail: { held: "monthly_budget" } } });
        return { ok: false, message: "Held: this month's referral budget is used up. Approve it by hand to pay anyway." };
      }
    }

    const capped = await tx.referralCode.updateMany({
      where: { id: referral.codeId, timesRedeemed: { lt: program.maxRewardsPerReferrer } },
      data: { timesRedeemed: { increment: 1 } },
    });
    if (capped.count === 0) {
      await moveReferral(tx, id, "HELD", "VOID", actor, { reason: "cap_reached" }, { voidReason: "cap_reached" });
      return { ok: false, message: "Not paid: this referrer has already earned the most rewards allowed." };
    }
    await tx.walletEntry.create({
      data: {
        customerId: referral.referrerId,
        amount: fromPaise(program.referrerRewardPaise),
        kind: "REFERRAL_CREDIT",
        referralId: id,
        expiresAt: new Date(Date.now() + program.creditExpiryDays * DAY),
        note: "Referral reward",
      },
    });
    await moveReferral(tx, id, "HELD", "REWARDED", actor, { rewardPaise: program.referrerRewardPaise, override }, { flagged: false });
    return { ok: true, message: `Paid ${fromPaiseTag(program.referrerRewardPaise)} credit to the referrer.` };
  });
}

export async function voidReferral(id: string, reason: string, actor: string): Promise<RewardResult> {
  return db.$transaction(async (tx) => {
    const referral = await tx.referral.findUnique({ where: { id } });
    if (!referral || ["REWARDED", "VOID", "EXPIRED"].includes(referral.status)) return { ok: false, message: "That referral is already settled." };
    await moveReferral(tx, id, referral.status, "VOID", actor, { reason }, { voidReason: reason, flagged: false });
    return { ok: true, message: "Referral voided. No reward will be paid." };
  });
}

/** Reviewed and fine: clear the flag, and it pays when its hold ends. */
export async function clearReferralFlag(id: string, actor: string): Promise<RewardResult> {
  await db.$transaction(async (tx) => {
    await tx.referral.update({ where: { id }, data: { flagged: false } });
    const r = await tx.referral.findUniqueOrThrow({ where: { id } });
    await tx.referralEvent.create({ data: { referralId: id, fromStatus: r.status, toStatus: r.status, actor, detail: { reviewed: true } } });
  });
  return { ok: true, message: "Marked as reviewed. It pays when the return window ends." };
}

/** The scheduled job: pay held referrals whose window has passed, expire stale sign-ups. */
export async function runReferralJobs(now = new Date()): Promise<{ paid: number; held: number; expired: number }> {
  const program = await getProgram();
  const due = await db.referral.findMany({ where: { status: "HELD", flagged: false, holdUntil: { lte: now } }, select: { id: true }, take: 200 });
  let paid = 0;
  let held = 0;
  for (const r of due) {
    const result = await rewardReferral(r.id, "SYSTEM");
    if (result.ok) paid++;
    else held++;
  }
  const stale = await db.referral.findMany({
    where: { status: "ATTRIBUTED", attributedAt: { lt: new Date(now.getTime() - program.attributionDays * DAY) } },
    select: { id: true },
    take: 500,
  });
  let expired = 0;
  for (const r of stale) {
    if (await db.$transaction((tx) => moveReferral(tx, r.id, "ATTRIBUTED", "EXPIRED", "SYSTEM", { reason: "no_first_order" }))) expired++;
  }
  return { paid, held, expired };
}

// --------------------------------------------------------------------------
// The account page's view
// --------------------------------------------------------------------------

const STAGE_WORDS: Record<ReferralStatus, string> = {
  ATTRIBUTED: "Signed up, no order yet",
  QUALIFYING: "Ordered, on its way",
  HELD: "Delivered, reward soon",
  REWARDED: "Reward earned",
  VOID: "Didn't qualify",
  EXPIRED: "Didn't order in time",
};

export async function accountReferrals(customerId: string) {
  const program = await getProgram();
  if (!program.isActive) return null;
  const code = await ensureReferralCode(customerId);
  const [codeRow, referrals, entries] = await Promise.all([
    db.referralCode.findUnique({ where: { customerId } }),
    db.referral.findMany({
      where: { referrerId: customerId },
      include: { referee: { select: { name: true } } },
      orderBy: { attributedAt: "desc" },
      take: 20,
    }),
    ledger(customerId),
  ]);
  const wallet = walletState(entries, new Date());
  return {
    code,
    rewardsIssued: codeRow?.timesRedeemed ?? 0,
    maxRewards: program.maxRewardsPerReferrer,
    referrerRewardPaise: program.referrerRewardPaise,
    refereeRewardPaise: program.refereeRewardPaise,
    minOrderPaise: program.minOrderPaise,
    maxCreditPerOrderPaise: program.maxCreditPerOrderPaise,
    walletPaise: wallet.availablePaise,
    nextExpiry: wallet.nextExpiry ? { paise: wallet.nextExpiry.remainingPaise, on: wallet.nextExpiry.expiresAt } : null,
    friends: referrals.map((r) => ({
      id: r.id,
      label: friendLabel(r.referee.name),
      stage: STAGE_WORDS[r.status],
      done: r.status === "REWARDED",
      since: r.attributedAt,
      holdUntil: r.status === "HELD" ? r.holdUntil : null,
    })),
  };
}

/** Whether this customer came through a referral already (the code box hides then). */
export async function isReferred(customerId: string): Promise<boolean> {
  return (await db.referral.count({ where: { refereeId: customerId } })) > 0;
}
