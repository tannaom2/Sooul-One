import "server-only";
import { db } from "@/lib/db";
import { decimalToPaise } from "@/lib/format";
import { SELLABLE_BATCH_WHERE } from "@/lib/basket-rules";
import { stockView } from "@/lib/stock-view";
import { findNearExpiryBatches } from "@/lib/compliance/fefo";
import { licenceStatus } from "@/lib/suppliers";
import { runInsights } from "@/lib/intel/insights-engine";
import { attentionLines, digestSubject, salesLine, type DigestData } from "@/lib/digest";
import { sendOwnerDigestEmail } from "@/lib/email";
import type { SendResult } from "@/lib/messages";
import { getBusinessProfile } from "@/server/business";
import { getCopilotContext } from "@/server/copilot";
import { deliverNow } from "@/server/messages";

/**
 * The owner's daily summary email (benchmark gap M5; wording in
 * src/lib/digest.ts). At 8 am India time the cron job (/api/cron/digest)
 * queues one for the day, and the queue sends it. It's built when it goes,
 * from the same figures as the dashboard, with the Copilot's rule-based
 * insights (the same cards as the dashboard's, without waiting on a model).
 */

const DAY = 86_400_000;
const IST = 5.5 * 60 * 60 * 1000;

/** The day's key, so the job running twice sends one email. */
export const digestKey = (now: Date) => `owner_digest:${new Date(now.getTime() + IST).toISOString().slice(0, 10)}`;

export async function digestEnabled(): Promise<boolean> {
  const row = await db.storeSettings.findUnique({ where: { id: "default" }, select: { dailyDigest: true } });
  return row?.dailyDigest ?? true;
}

export async function loadDigest(now = new Date()): Promise<DigestData> {
  const today = new Date(Math.floor((now.getTime() + IST) / DAY) * DAY - IST);
  const yesterday = new Date(today.getTime() - DAY);
  const period = (from: Date, to: Date) => ({ placedAt: { gte: from, lt: to }, status: { notIn: ["PENDING_PAYMENT", "FAILED", "CANCELLED"] as never } });
  const [yd, wk, toPack, oldest, returnsToCheck, failedMessages, newEnquiries, pendingReviews, products, suppliers, ctx] = await Promise.all([
    db.order.aggregate({ where: period(yesterday, today), _sum: { totalAmount: true }, _count: { _all: true } }),
    db.order.aggregate({ where: period(new Date(yesterday.getTime() - 7 * DAY), new Date(today.getTime() - 7 * DAY)), _sum: { totalAmount: true }, _count: { _all: true } }),
    db.order.count({ where: { status: { in: ["PAID", "PROCESSING"] } } }),
    db.order.findFirst({ where: { status: { in: ["PAID", "PROCESSING"] } }, orderBy: { placedAt: "asc" }, select: { placedAt: true } }),
    db.order.count({ where: { status: { in: ["RTO", "RETURNED"] }, items: { some: { OR: [{ returnCheck: null }, { returnCheck: { outcome: "QUARANTINED" } }] } } } }),
    db.outboundMessage.count({ where: { status: "FAILED" } }),
    db.enquiry.count({ where: { status: "NEW" } }),
    db.review.count({ where: { isApproved: false } }),
    db.product.findMany({ where: { isActive: true }, include: { batches: { where: SELLABLE_BATCH_WHERE } } }),
    db.supplier.findMany({ where: { isActive: true }, select: { name: true, fssaiLicence: true, licenceExpiresOn: true, _count: { select: { manufactured: { where: { isActive: true } }, marketed: { where: { isActive: true } } } } } }),
    getCopilotContext().catch(() => null),
  ]);

  const runningLow = products
    .map((p) => ({ name: p.name, stock: stockView(p, now) }))
    .filter((p) => p.stock.low)
    .sort((a, b) => a.stock.shippable - b.stock.shippable)
    .map((p) => ({ name: p.name, shippable: p.stock.shippable }));
  const nearUnsellable = products
    .flatMap((p) =>
      p.shelfLifeDays && p.batches.length
        ? findNearExpiryBatches(
            p.batches.map((b) => ({ id: b.id, batchNumber: b.batchNumber, expiresOn: b.expiresOn, quantityRemaining: b.quantityRemaining })),
            p.shelfLifeDays,
            now,
            21,
          ).map((b) => ({ name: p.name, batchNumber: b.batchNumber, days: b.daysUntilUnsellable }))
        : [],
    )
    .sort((a, b) => a.days - b.days);
  const licences = suppliers
    .map((s) => {
      const status = licenceStatus(s, now);
      return {
        supplier: s.name,
        missing: status.state === "missing",
        days: "days" in status ? (status.days ?? null) : null,
        usedByLive: s._count.manufactured + s._count.marketed > 0,
      };
    })
    .filter((l) => l.missing || (l.days !== null && l.days <= 60));
  const insights = ctx
    ? runInsights(ctx)
        .insights.filter((i) => i.severity !== "info")
        .slice(0, 3)
        .map((i) => ({ title: i.title, detail: i.detail, severity: i.severity }))
    : [];

  return {
    yesterday: { orders: yd._count._all, revenuePaise: decimalToPaise(yd._sum.totalAmount) },
    weekBefore: { orders: wk._count._all, revenuePaise: decimalToPaise(wk._sum.totalAmount) },
    toPack,
    oldestWaitingDays: oldest ? Math.floor((now.getTime() - oldest.placedAt.getTime()) / DAY) : null,
    returnsToCheck,
    failedMessages,
    newEnquiries,
    pendingReviews,
    runningLow,
    nearUnsellable,
    licences,
    insights,
  };
}

/** Queue today's summary (the cron job, or "Send it now"), and send it straight away. */
export async function sendDigestNow(now = new Date(), key = digestKey(now)) {
  return deliverNow({ kind: "owner_digest", dedupeKey: key });
}

/** The queue's sender for owner_digest. */
export async function sendOwnerDigest(now = new Date()): Promise<SendResult> {
  if (!(await digestEnabled())) return { delivered: false, reason: "opted_out" };
  const to = process.env.OWNER_ALERT_EMAIL || (await getBusinessProfile()).customerCareEmail;
  if (!to) return { delivered: false, reason: "no_recipient" };
  const data = await loadDigest(now);
  const site = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return sendOwnerDigestEmail(to, {
    subject: digestSubject(data),
    sales: salesLine(data),
    lines: attentionLines(data).map((l) => ({ text: l.text, url: `${site}${l.path}`, urgent: l.urgent })),
    insights: data.insights,
    consoleUrl: `${site}/admin`,
    settingsUrl: `${site}/admin/messages`,
  });
}
