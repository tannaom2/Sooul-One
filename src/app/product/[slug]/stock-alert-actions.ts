"use server";

import { z } from "zod";
import { reportError } from "@/lib/observability";
import { getCustomer } from "@/server/customer-auth";
import { limitPublic } from "@/server/rate-limit";
import { requestStockAlert, type AlertRequest } from "@/server/stock-alerts";

const input = z.object({ productId: z.string().min(1).max(40), email: z.email("Enter an email address we can write to.").max(200) });

/** "Email me when it's back" on a sold-out product (src/server/stock-alerts.ts). */
export async function askBackInStock(productId: string, email: string): Promise<AlertRequest> {
  if (await limitPublic("stockAlert")) return { ok: false, message: "Too many requests from your connection. Try again later." };
  const parsed = input.safeParse({ productId, email: email.trim().toLowerCase() });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Enter an email address." };
  try {
    const customer = await getCustomer();
    return await requestStockAlert(parsed.data.productId, parsed.data.email, customer?.id ?? null);
  } catch (error) {
    reportError("stock-alert/ask", error);
    return { ok: false, message: "That didn't save. Try again in a moment." };
  }
}
