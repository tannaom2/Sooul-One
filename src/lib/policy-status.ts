/**
 * Policy pages still holding draft prompts rather than final text
 * (src/app/policies/[policy]/page.tsx). The launch checklist reads this.
 * Remove a slug in the same change that gives its page final, reviewed text.
 */
export const DRAFT_POLICIES: readonly string[] = ["privacy", "terms", "refunds", "shipping"];
