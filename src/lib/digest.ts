/**
 * The owner's daily summary email (benchmark gap M5). Pure: given the morning's
 * figures, what the email says and links to. Tested (tests/digest.test.ts);
 * gathering the figures and sending is src/server/digest.ts.
 */

export interface DigestData {
  /** Yesterday in India time, and the same weekday a week before. */
  readonly yesterday: { orders: number; revenuePaise: number };
  readonly weekBefore: { orders: number; revenuePaise: number };
  readonly toPack: number;
  /** Days the oldest order waiting to be packed has waited, or null. */
  readonly oldestWaitingDays: number | null;
  readonly returnsToCheck: number;
  readonly failedMessages: number;
  readonly newEnquiries: number;
  readonly pendingReviews: number;
  readonly runningLow: readonly { name: string; shippable: number }[];
  readonly nearUnsellable: readonly { name: string; batchNumber: string; days: number }[];
  readonly licences: readonly { supplier: string; days: number | null; missing: boolean; usedByLive: boolean }[];
  readonly insights: readonly { title: string; detail: string; severity: string }[];
}

export interface DigestLine {
  readonly text: string;
  readonly path: string;
  /** Needs doing today, rather than worth knowing. */
  readonly urgent: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** What needs doing, most urgent first. Each line links into the console. */
export function attentionLines(d: DigestData): DigestLine[] {
  const lines: DigestLine[] = [];
  if (d.toPack > 0) {
    const wait = d.oldestWaitingDays && d.oldestWaitingDays >= 2 ? `, the oldest waiting ${plural(d.oldestWaitingDays, "day")}` : "";
    lines.push({ text: `${plural(d.toPack, "order")} to pack and ship${wait}`, path: "/admin/orders?view=to_ship", urgent: true });
  }
  const badLicences = d.licences.filter((l) => l.usedByLive && (l.missing || (l.days !== null && l.days <= 14)));
  for (const l of badLicences) {
    const what = l.missing ? "has no FSSAI licence number" : l.days !== null && l.days < 0 ? "has an expired FSSAI licence" : `'s FSSAI licence expires in ${plural(l.days ?? 0, "day")}`;
    lines.push({ text: `${l.supplier}${what.startsWith("'") ? what : ` ${what}`}`, path: "/admin/suppliers", urgent: true });
  }
  if (d.returnsToCheck > 0) lines.push({ text: `${plural(d.returnsToCheck, "returned parcel")} to check`, path: "/admin/orders?view=returned", urgent: true });
  if (d.failedMessages > 0) lines.push({ text: `${plural(d.failedMessages, "email")} failed to send after every retry`, path: "/admin/messages", urgent: true });
  if (d.nearUnsellable.length > 0) {
    const first = d.nearUnsellable[0];
    lines.push({
      text: `${plural(d.nearUnsellable.length, "batch", "batches")} close to unsellable (soonest: ${first.name} ${first.batchNumber}, ${plural(first.days, "day")})`,
      path: "/admin#expiry",
      urgent: false,
    });
  }
  if (d.runningLow.length > 0) {
    const names = d.runningLow.slice(0, 3).map((p) => `${p.name} (${p.shippable})`).join(", ");
    lines.push({ text: `${plural(d.runningLow.length, "product")} running low: ${names}${d.runningLow.length > 3 ? "…" : ""}`, path: "/admin/batches", urgent: false });
  }
  if (d.newEnquiries > 0) lines.push({ text: `${plural(d.newEnquiries, "enquiry", "enquiries")} waiting for a reply`, path: "/admin/enquiries", urgent: false });
  if (d.pendingReviews > 0) lines.push({ text: `${plural(d.pendingReviews, "review")} waiting for approval`, path: "/admin/reviews", urgent: false });
  return lines;
}

/** Yesterday against the same day last week, in one sentence. */
export function salesLine(d: DigestData): string {
  const y = d.yesterday;
  const w = d.weekBefore;
  const base = `${plural(y.orders, "order")}, ${inr(y.revenuePaise)}`;
  if (w.orders === 0 && w.revenuePaise === 0) return `Yesterday: ${base}.`;
  const change = w.revenuePaise > 0 ? Math.round(((y.revenuePaise - w.revenuePaise) / w.revenuePaise) * 100) : null;
  const vs = `${plural(w.orders, "order")}, ${inr(w.revenuePaise)} the same day last week`;
  return `Yesterday: ${base}${change === null ? "" : change === 0 ? ", level with" : change > 0 ? `, up ${change}% on` : `, down ${-change}% on`} ${change === null ? `(against ${vs})` : vs}.`;
}

/** The subject: what matters most, so the inbox line alone is useful. */
export function digestSubject(d: DigestData): string {
  const urgent = attentionLines(d).filter((l) => l.urgent).length;
  const sales = `${plural(d.yesterday.orders, "order")} yesterday`;
  return urgent > 0 ? `SooulOne today: ${plural(urgent, "thing")} to do · ${sales}` : `SooulOne today: all clear · ${sales}`;
}
