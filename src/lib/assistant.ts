/**
 * The storefront assistant's rules (src/components/storefront-bot.tsx,
 * /api/chatbot/message). Pure, so every rule is tested (tests/assistant.test.ts).
 *
 * It runs on rules, not an AI model: no cost, no customer data leaving the
 * store, and no chance of it making up a policy. Everything it says is
 * either a fact the store holds (the delivery area, delivery fee, COD rules,
 * an order's own status) or words the owner wrote (return conditions). Where
 * the store doesn't know, it hands over to a person.
 */

/* ---------------------------------------------------------------- shapes */

export type Intent = "menu" | "track" | "pincode" | "returns" | "shipping" | "payment" | "cod" | "area" | "contact" | "human" | "unknown";

export interface QuickReply {
  readonly label: string;
  readonly intent: Intent;
}

export interface TimelineStage {
  readonly label: string;
  readonly done: boolean;
  readonly current: boolean;
  /** ISO date, or null. */
  readonly date: string | null;
}

export type BotBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "timeline";
      readonly orderNumber: string;
      readonly stages: readonly TimelineStage[];
      readonly ended: { readonly label: string; readonly date: string | null } | null;
      readonly tracking: { readonly number: string; readonly courier: string | null } | null;
    }
  | {
      readonly type: "pincode";
      readonly pincode: string;
      readonly place: string | null;
      readonly serviceable: boolean;
      readonly arrivesBy: string | null;
      readonly cod: { readonly allowed: boolean; readonly note: string | null };
      readonly deliveryFeePaise: number;
      readonly freeAbovePaise: number;
    }
  | { readonly type: "handoff"; readonly whatsapp: string | null; readonly email: string | null; readonly phone: string | null }
  | { readonly type: "links"; readonly links: readonly { readonly label: string; readonly href: string }[] };

/** What the widget should ask for next, and what it has collected so far. */
export interface BotState {
  readonly flow: "track" | "returns" | "pincode" | null;
  readonly orderNumber?: string;
}

export interface BotReply {
  readonly blocks: readonly BotBlock[];
  readonly quickReplies: readonly QuickReply[];
  /** The input the widget should prompt for next. */
  readonly expect: "orderNumber" | "contact" | "pincode" | "text";
  readonly state: BotState;
}

export const MENU: readonly QuickReply[] = [
  { label: "Track my order", intent: "track" },
  { label: "Check delivery to my pincode", intent: "pincode" },
  { label: "Returns and refunds", intent: "returns" },
  { label: "Delivery charges", intent: "shipping" },
  { label: "Ways to pay", intent: "payment" },
  { label: "Talk to a person", intent: "human" },
];

/* ------------------------------------------------------------ understanding */

/** Order numbers look like SO-MUK6CTLL-I2. */
export const ORDER_NUMBER = /\bSO-[A-Z0-9]{6,10}-[A-Z0-9]{2}\b/i;

export function findOrderNumber(text: string): string | null {
  return ORDER_NUMBER.exec(text)?.[0].toUpperCase() ?? null;
}

export function findPincode(text: string): string | null {
  return /(?:^|\D)(\d{6})(?:\D|$)/.exec(text)?.[1] ?? null;
}

/** A 10-digit Indian mobile (optionally with +91 or 0) or an email address. */
export function parseContact(text: string): { phone: string } | { email: string } | null {
  const email = /[^\s@]+@[^\s@]+\.[^\s@]+/.exec(text.trim())?.[0];
  if (email) return { email: email.toLowerCase().slice(0, 200) };
  const digits = text.replace(/\D/g, "");
  const phone = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(phone) ? { phone } : null;
}

/** What a free-typed message is about. Keywords, in the order that disambiguates best. */
export function classifyMessage(text: string): Intent {
  const t = text.toLowerCase();
  if (!t.trim()) return "menu";
  if (findOrderNumber(text) || /\b(track|where is|where's|status|order status|not (yet )?(arrived|delivered|received)|dispatch|shipped)\b/.test(t)) return "track";
  if (/\b(return|refund|exchange|replace|damaged|broken|wrong item|expired)\b/.test(t)) return "returns";
  if (/\b(cod|cash on delivery|pay on delivery|cash)\b/.test(t)) return "cod";
  if (/\b(deliver|delivery|pincode|pin code|ship to|serviceable|reach)\b/.test(t) && findPincode(text)) return "pincode";
  if (/\b(pincode|pin code|serviceable|do you deliver)\b/.test(t)) return "pincode";
  if (/\b(shipping|delivery (charge|fee|cost)|free delivery|how long|how many days)\b/.test(t)) return "shipping";
  if (/\b(pay|payment|upi|card|net ?banking|wallet|razorpay)\b/.test(t)) return "payment";
  if (/\b(which (city|cities|state)|gujarat|outside|mumbai|delhi|bangalore|bengaluru|pune)\b/.test(t)) return "area";
  if (/\b(human|person|agent|someone|call|whatsapp|email|contact|support|help ?desk|complain)\b/.test(t)) return "human";
  if (/^(hi|hello|hey|namaste|menu|help|start)\b/.test(t)) return "menu";
  if (findPincode(text)) return "pincode";
  return "unknown";
}

/* ---------------------------------------------------------------- returns */

export type ReturnVerdict =
  | { readonly kind: "not-delivered"; readonly status: string }
  | { readonly kind: "no-window" }
  | { readonly kind: "within"; readonly daysLeft: number }
  | { readonly kind: "outside"; readonly daysSince: number }
  | { readonly kind: "closed"; readonly label: string };

/**
 * Where an order stands for a return, using only the owner's window. No
 * window set means the assistant doesn't judge; a person does.
 */
export function returnVerdict(order: { status: string; deliveredAt: Date | null }, windowDays: number | null, now: Date): ReturnVerdict {
  if (order.status === "RETURNED" || order.status === "REFUNDED") return { kind: "closed", label: order.status === "RETURNED" ? "already returned" : "already refunded" };
  if (order.status !== "DELIVERED" || !order.deliveredAt) return { kind: "not-delivered", status: order.status };
  if (windowDays === null) return { kind: "no-window" };
  const days = Math.floor((now.getTime() - order.deliveredAt.getTime()) / 86_400_000);
  return days <= windowDays ? { kind: "within", daysLeft: windowDays - days } : { kind: "outside", daysSince: days };
}

/* --------------------------------------------------------------- hand-over */

/** A wa.me link with a prefilled message (order number included when known). */
export function whatsappLink(number: string | null, orderNumber?: string, topic = "help"): string | null {
  if (!number || !/^[6-9]\d{9}$/.test(number)) return null;
  const text = orderNumber ? `Hi SooulOne, I need ${topic} with order ${orderNumber}.` : `Hi SooulOne, I need ${topic}.`;
  return `https://wa.me/91${number}?text=${encodeURIComponent(text)}`;
}

export const reply = (blocks: BotBlock[], extra: Partial<Omit<BotReply, "blocks">> = {}): BotReply => ({
  blocks,
  quickReplies: extra.quickReplies ?? MENU,
  expect: extra.expect ?? "text",
  state: extra.state ?? { flow: null },
});
