import * as z from "zod/mini";
import { checkoutInputSchema } from "../validation/checkout";

/**
 * The three checkout steps and which fields each owns. Validation reuses the
 * exact schema create-order enforces, one step's fields at a time, so a step
 * can't be passed with data the server would then reject. Pure, tested.
 */

export type CheckoutStep = "contact" | "address" | "payment";

export const STEPS: readonly CheckoutStep[] = ["contact", "address", "payment"];

export interface CheckoutForm {
  phone: string;
  email: string;
  postalCode: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  couponCode: string;
}

export const EMPTY_FORM: CheckoutForm = {
  phone: "",
  email: "",
  postalCode: "",
  name: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  couponCode: "",
};

const STEP_FIELDS = {
  contact: { phone: true, email: true },
  address: { postalCode: true, name: true, line1: true, city: true, state: true },
} as const;

/** Field errors for one step; empty when the step is complete. */
export function validateStep(step: CheckoutStep, form: CheckoutForm): Record<string, string> {
  if (step === "payment") return {};
  const result = z.pick(checkoutInputSchema, STEP_FIELDS[step]).safeParse(normalise(form));
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0]);
    errors[key] ??= issue.message;
  }
  return errors;
}

/** The first step that isn't complete yet: where a returning shopper resumes. */
export function firstIncompleteStep(form: CheckoutForm): CheckoutStep {
  if (Object.keys(validateStep("contact", form)).length) return "contact";
  if (Object.keys(validateStep("address", form)).length) return "address";
  return "payment";
}

/** One-line summary shown when a finished step collapses. */
export function stepSummary(step: CheckoutStep, form: CheckoutForm): string {
  if (step === "contact") return `${form.phone} · ${form.email}`;
  if (step === "address") return [form.name, form.line1, form.city, form.postalCode].filter(Boolean).join(", ");
  return "";
}

/** Trims and strips phone formatting the way a shopper types it ("+91 98765 43210"). */
export function normalise(form: CheckoutForm): CheckoutForm {
  const digits = form.phone.replace(/\D/g, "");
  return {
    ...form,
    phone: digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.replace(/^0(?=\d{10}$)/, ""),
    email: form.email.trim(),
    postalCode: form.postalCode.replace(/\s/g, ""),
    name: form.name.trim(),
    line1: form.line1.trim(),
    line2: form.line2.trim(),
    city: form.city.trim(),
    state: form.state.trim(),
    couponCode: form.couponCode.trim().toUpperCase(),
  };
}
