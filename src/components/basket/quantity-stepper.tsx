"use client";

import { MAX_LINE_QUANTITY } from "@/lib/basket-types";

/**
 * − / + stepper. Buttons rather than a number field: a phone keyboard for a
 * single digit is slower than a tap, and each tap is a clear, undoable step.
 * 44px targets per touch guidelines.
 */
export function QuantityStepper({
  value,
  onChange,
  label,
  min = 1,
  disabled = false,
}: {
  value: number;
  onChange: (next: number) => void;
  /** What the quantity is of, for screen readers: "Roasted Makhana". */
  label: string;
  min?: number;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center border border-[--color-rule]" style={{ borderRadius: "var(--radius-panel)" }} role="group" aria-label={`Quantity of ${label}`}>
      <button
        type="button"
        className="grid h-11 w-11 place-items-center text-lead disabled:text-ink-faint"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        aria-label={value - 1 === 0 ? `Remove ${label}` : `One fewer ${label}`}
      >
        {value - 1 === 0 && min === 0 ? "×" : "−"}
      </button>
      <span className="tabular min-w-8 text-center text-small font-semibold" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="grid h-11 w-11 place-items-center text-lead disabled:text-ink-faint"
        onClick={() => onChange(Math.min(MAX_LINE_QUANTITY, value + 1))}
        disabled={disabled || value >= MAX_LINE_QUANTITY}
        aria-label={`One more ${label}`}
      >
        +
      </button>
    </div>
  );
}
