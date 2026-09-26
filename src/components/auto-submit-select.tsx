"use client";

/**
 * A filter dropdown that applies as soon as it changes, like the status tabs
 * next to it, instead of waiting for the form's button. The button stays for
 * the search text and for anyone without JavaScript.
 */
export function AutoSubmitSelect(props: React.ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
