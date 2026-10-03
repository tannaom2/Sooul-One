/**
 * The rules of the message queue (benchmark gap M11): what kinds of message
 * there are, when a failed one is tried again, and which failures are final.
 * Pure, so they're tested directly (tests/messages.test.ts); the queue itself
 * is src/server/messages.ts.
 */

export const MESSAGE_KINDS = {
  order_confirmation: "Order confirmation email",
  shipping_notification: "Shipping email",
  owner_new_order: "New-order email to you",
  enquiry_notice: "New enquiry email to you",
  refill_reminder: "Refill reminder email",
  supplier_licence_expiry: "Supplier licence expiry email to you",
  recall_notice: "Recall notice email",
} as const;

export type MessageKind = keyof typeof MESSAGE_KINDS;

export const isMessageKind = (k: string): k is MessageKind => k in MESSAGE_KINDS;

/** Keys, so every caller names a message the same way. */
export const messageKey = {
  orderConfirmation: (orderId: string) => `order_confirmation:${orderId}`,
  shipping: (orderId: string) => `shipping_notification:${orderId}`,
  ownerNewOrder: (orderId: string) => `owner_new_order:${orderId}`,
  enquiry: (enquiryId: string) => `enquiry_notice:${enquiryId}`,
};

/** The waits before each retry: a blip clears in minutes, an outage in hours. */
export const RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 720] as const;

/** Attempts in all, the first send included. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;

/** How long a worker may hold a message before another can take it. */
export const LOCK_MINUTES = 5;

/** When to try again after this many attempts, or null when it's time to give up. */
export function nextAttemptAt(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const minutes = RETRY_DELAYS_MINUTES[Math.max(0, attempts - 1)] ?? RETRY_DELAYS_MINUTES[RETRY_DELAYS_MINUTES.length - 1];
  return new Date(now.getTime() + minutes * 60_000);
}

/** What a sender reports, the same shape src/lib/email.ts already returns. */
export interface SendResult {
  readonly delivered: boolean;
  readonly reason?: string;
}

/**
 * Reasons that won't change by trying again: no address, a test address,
 * sending not set up on this server, or the thing it was about has gone.
 */
const FINAL_REASONS = new Set(["no_recipient", "test_address", "not_configured", "not_found", "opted_out", "not_due", "reordered"]);

export type Outcome =
  | { readonly status: "SENT" }
  | { readonly status: "SKIPPED"; readonly reason: string }
  | { readonly status: "PENDING"; readonly reason: string; readonly retryAt: Date }
  | { readonly status: "FAILED"; readonly reason: string };

/** Where a message goes after an attempt (the attempt already counted in `attempts`). */
export function outcomeOf(result: SendResult, attempts: number, now: Date): Outcome {
  if (result.delivered) return { status: "SENT" };
  const reason = (result.reason ?? "unknown").slice(0, 300);
  if (FINAL_REASONS.has(reason)) return { status: "SKIPPED", reason };
  const retryAt = nextAttemptAt(attempts, now);
  return retryAt ? { status: "PENDING", reason, retryAt } : { status: "FAILED", reason };
}

/** Plain words for a skip or failure reason, for the console. */
export function reasonLabel(reason: string | null): string {
  switch (reason) {
    case null:
      return "";
    case "no_recipient":
      return "No email address to send to";
    case "test_address":
      return "A test address, so not sent";
    case "not_configured":
      return "Email isn't set up on this server";
    case "not_found":
      return "What it was about no longer exists";
    case "opted_out":
      return "The shopper turned these off";
    case "not_due":
      return "No longer needed";
    case "reordered":
      return "They'd already ordered it again";
    case "exception":
      return "The email service didn't answer";
    default:
      return reason.startsWith("exception") ? `Something went wrong sending it (${reason.slice(11) || "no detail"})` : reason;
  }
}
