import "server-only";
import { reportError } from "@/lib/observability";

/**
 * Sign-in codes by SMS, through MSG91.
 *
 * Indian SMS has to go through TRAI's DLT system: SooulOne registers as a
 * sender, gets a sender ID (header) and an approved template with a slot for
 * the code, and MSG91 links that template to MSG91_OTP_TEMPLATE_ID. Until both
 * keys are set, codeDelivery() in src/lib/otp.ts never calls this.
 *
 * Checked against MSG91's OTP API (v5) as documented; confirm against their
 * current docs when the account is set up, then send one real code before
 * relying on it.
 */

export interface SmsResult {
  readonly delivered: boolean;
  readonly reason?: string;
}

const ENDPOINT = "https://control.msg91.com/api/v5/otp";

export async function sendCodeSms(phone: string, code: string, ttlMinutes: number): Promise<SmsResult> {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID;
  if (!authKey || !templateId) return { delivered: false, reason: "not_configured" };

  const url = new URL(ENDPOINT);
  url.searchParams.set("template_id", templateId);
  url.searchParams.set("mobile", `91${phone}`);
  // Our own code, so checking it stays here (src/lib/otp.ts) rather than
  // depending on the provider's verify call.
  url.searchParams.set("otp", code);
  url.searchParams.set("otp_expiry", String(ttlMinutes));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { authkey: authKey, "Content-Type": "application/json", accept: "application/json" },
      body: "{}",
      // A shopper is waiting at checkout; better to say "try again" than hang.
      signal: AbortSignal.timeout(8000),
    });
    const body = (await response.json().catch(() => null)) as { type?: string; message?: string } | null;
    if (!response.ok || body?.type !== "success") {
      reportError("sms", new Error(`MSG91 refused: ${response.status} ${body?.message ?? ""}`.trim()));
      return { delivered: false, reason: "provider_refused" };
    }
    return { delivered: true };
  } catch (error) {
    reportError("sms", error);
    return { delivered: false, reason: "exception" };
  }
}
