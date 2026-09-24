/**
 * Summarises storefront interaction events (src/lib/client-events.ts) for the
 * admin Funnel page: unique sessions per interaction, with checkout split by
 * step and payment by method. Pure, so it's tested directly.
 */

export const INTERACTION_TYPES = [
  "CART_OPENED",
  "OFFER_SHOWN",
  "OFFER_APPLIED",
  "CHECKOUT_STEP",
  "PAYMENT_METHOD_SELECTED",
] as const;

type Row = { sessionId: string; type: string; metadata: unknown };

export interface InteractionLine {
  readonly label: string;
  readonly sessions: number;
}

const LINES: { label: string; match: (r: Row) => boolean }[] = [
  { label: "Opened the basket", match: (r) => r.type === "CART_OPENED" },
  { label: "Saw an offer", match: (r) => r.type === "OFFER_SHOWN" },
  { label: "Used an offer", match: (r) => r.type === "OFFER_APPLIED" },
  { label: "Checkout: contact step", match: (r) => r.type === "CHECKOUT_STEP" && meta(r, "step") === "contact" },
  { label: "Checkout: address step", match: (r) => r.type === "CHECKOUT_STEP" && meta(r, "step") === "address" },
  { label: "Checkout: payment step", match: (r) => r.type === "CHECKOUT_STEP" && meta(r, "step") === "payment" },
  { label: "Chose UPI", match: (r) => r.type === "PAYMENT_METHOD_SELECTED" && meta(r, "method") === "UPI" },
  { label: "Chose card or other online", match: (r) => r.type === "PAYMENT_METHOD_SELECTED" && ["CARD", "RAZORPAY"].includes(meta(r, "method") ?? "") },
  { label: "Chose cash on delivery", match: (r) => r.type === "PAYMENT_METHOD_SELECTED" && meta(r, "method") === "COD" },
];

function meta(r: Row, key: string): string | undefined {
  const m = r.metadata as Record<string, unknown> | null;
  const v = m && typeof m === "object" ? m[key] : undefined;
  return typeof v === "string" ? v : undefined;
}

export function summariseInteractions(rows: readonly Row[]): InteractionLine[] {
  return LINES.map(({ label, match }) => ({
    label,
    sessions: new Set(rows.filter(match).map((r) => r.sessionId)).size,
  }));
}
