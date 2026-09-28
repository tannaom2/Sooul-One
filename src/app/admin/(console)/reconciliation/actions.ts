"use server";

import { requirePermission, audit } from "@/lib/auth";
import { reconcilePayments, type ReconciliationResult } from "@/lib/reconciliation";

/**
 * Runs on demand rather than on a schedule — this is an audit a human reads,
 * not an alert that pages someone, so there's no value in running it while
 * nobody's looking. Logged to the audit trail like any other admin action
 * that touches money, even though it's read-only, so "who checked this and
 * when" survives even if the finding itself doesn't get acted on immediately.
 */
export async function runReconciliation(windowDays: number): Promise<ReconciliationResult> {
  const session = await requirePermission("finance:view");
  if (!session) throw new Error("Not authorized.");

  const result = await reconcilePayments(windowDays);

  await audit(session, "RUN_RECONCILIATION", "PaymentReconciliation", "-", {
    windowDays,
    localOrdersChecked: result.localOrdersChecked,
    razorpayPaymentsChecked: result.razorpayPaymentsChecked,
    findingCount: result.findings.length,
  });

  return result;
}
