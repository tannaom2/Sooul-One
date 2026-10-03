"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { clientIp, PUBLIC_LIMITS } from "@/lib/rate-limit-rules";
import { overLimit } from "@/server/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { reportError } from "@/lib/observability";
import { deliverNow, messageKey } from "@/server/messages";
import { enquirySchema } from "@/lib/validation/site-content";

export interface EnquiryState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * A contact-form message (collaboration, delivery outside India, anything
 * else). Stored for the console's Enquiries inbox and emailed to the owner.
 * Guarded like the other public forms: a per-connection cap, Turnstile when
 * configured, and a hidden field that only scripts fill in.
 */
export async function sendEnquiry(_prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  const h = await headers();
  const ip = clientIp(h);

  // Filled in: a script. Answer as if it worked, and keep nothing.
  if (String(form.get("website") ?? "").trim()) return { ok: true, message: "Thanks, we've got your message." };

  try {
    if (await overLimit(`enquiry:ip:${ip}`, PUBLIC_LIMITS.enquiry)) {
      return { message: "You've sent several messages already. Please wait an hour, or email us directly." };
    }
  } catch (error) {
    reportError("enquiry/rate-limit", error);
  }

  const human = await verifyTurnstile(String(form.get("cf-turnstile-response") ?? "") || null, { ip, expectedAction: "enquiry", failOpen: true });
  if (!human.ok) return { message: "We couldn't confirm you're not a bot. Try again." };

  const parsed = enquirySchema.safeParse({
    kind: form.get("kind"),
    name: form.get("name") ?? "",
    email: form.get("email") ?? "",
    phone: form.get("phone") ?? "",
    organisation: form.get("organisation") ?? "",
    country: form.get("country") ?? "",
    message: form.get("message") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { message: "Check the highlighted fields.", fieldErrors };
  }

  let enquiryId: string;
  try {
    enquiryId = (await db.enquiry.create({ data: parsed.data, select: { id: true } })).id;
  } catch (error) {
    reportError("enquiry/save", error);
    return { message: "Something went wrong on our side. Please email us instead." };
  }

  // The owner's email notice, queued so a failed send is retried. The inbox (Enquiries) is the record either way.
  after(() => deliverNow({ kind: "enquiry_notice", dedupeKey: messageKey.enquiry(enquiryId), payload: { enquiryId } }));
  return { ok: true, message: "Thanks, we've got your message and will reply by email." };
}
