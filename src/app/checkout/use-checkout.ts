"use client";

import { useCallback, useEffect, useState } from "react";
import { track } from "@/lib/track";
import {
  EMPTY_FORM,
  STEPS,
  firstIncompleteStep,
  validateStep,
  type CheckoutForm,
  type CheckoutStep,
} from "@/lib/checkout/steps";

const DRAFT_KEY = "soulone_checkout_draft";

/** The saved draft, if any. Only call in the browser (the page renders the form after hydration). */
function readDraft(): CheckoutForm {
  try {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    return saved ? ({ ...EMPTY_FORM, ...JSON.parse(saved) } as CheckoutForm) : EMPTY_FORM;
  } catch {
    // Private mode or a corrupt draft: start fresh.
    return EMPTY_FORM;
  }
}

/**
 * Checkout's step machine: contact → address → payment. Finished steps stay
 * editable; moving on validates only the current step with the server's own
 * rules. The draft lives in sessionStorage (this tab only, gone when it
 * closes) so a refresh or a detour to the basket doesn't lose what was typed.
 */
export function useCheckout() {
  const [form, setForm] = useState<CheckoutForm>(readDraft);
  // A returning shopper resumes at the first unfinished step.
  const [step, setStep] = useState<CheckoutStep>(() => firstIncompleteStep(form));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      // Storage unavailable: the draft just isn't kept.
    }
  }, [form]);

  useEffect(() => {
    track({ type: "CHECKOUT_STEP", step });
  }, [step]);

  const set = useCallback((field: keyof CheckoutForm, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: "" } : e));
  }, []);

  /** Validate the current step; move on if it's complete. Returns the errors. */
  const next = useCallback(() => {
    const found = validateStep(step, form);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      const i = STEPS.indexOf(step);
      if (i < STEPS.length - 1) setStep(STEPS[i + 1]);
    }
    return found;
  }, [step, form]);

  const edit = useCallback((target: CheckoutStep) => {
    setErrors({});
    setStep(target);
  }, []);

  const clearDraft = useCallback(() => {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {}
  }, []);

  return { form, step, errors, setErrors, set, setForm, next, edit, clearDraft };
}
