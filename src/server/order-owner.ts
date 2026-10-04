import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { orderTokenMatches } from "@/lib/order-access";
import { getCustomer } from "@/server/customer-auth";

const input = z.object({ orderNumber: z.string().min(1).max(40), token: z.string().max(200).nullable() });

/**
 * The order, if this caller can open it: the token from its private link, or
 * the signed-in shopper it belongs to. The order page's actions (refill
 * reminders, reviews, stopping follow-ups) all start here. A plain module,
 * not a server action, so it can't be called from the browser itself.
 */
export async function ownOrder(orderNumber: string, token: string | null): Promise<{ id: string; accessToken: string | null; customerId: string | null } | null> {
  const parsed = input.safeParse({ orderNumber, token });
  if (!parsed.success) return null;
  const order = await db.order.findUnique({ where: { orderNumber: parsed.data.orderNumber }, select: { id: true, accessToken: true, customerId: true } });
  if (!order) return null;
  if (orderTokenMatches(parsed.data.token, order.accessToken)) return order;
  const customer = order.customerId ? await getCustomer() : null;
  return customer && customer.id === order.customerId ? order : null;
}
