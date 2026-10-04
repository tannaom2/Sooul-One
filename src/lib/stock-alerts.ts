/**
 * "Email me when it's back" (benchmark gap R9). Pure rules, tested
 * (tests/repeat-buying.test.ts); the rest is src/server/stock-alerts.ts.
 *
 * One email, once the product can be shipped again, then the request is
 * done. Asking is recorded as consent (purpose BACK_IN_STOCK) with the words
 * shown, since the email invites a purchase.
 */

export const STOCK_ALERT_PURPOSE = "BACK_IN_STOCK";
export const STOCK_ALERT_NOTICE = "Email me once when this is back in stock. Nothing else.";

/** A request this old has gone stale: they've likely bought elsewhere or moved on. */
export const STOCK_ALERT_DAYS = 90;

export const stockAlertKey = (alertId: string, askedAt: Date) => `back_in_stock:${alertId}:${askedAt.getTime()}`;

/** Whether a request is still worth acting on. */
export const alertLive = (askedAt: Date, now: Date) => now.getTime() - askedAt.getTime() <= STOCK_ALERT_DAYS * 86_400_000;
