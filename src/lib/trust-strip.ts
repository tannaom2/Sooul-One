/**
 * The home page's trust strip (Sprint 3): a line of facts the store keeps,
 * each from a setting, never a slogan. A fact the owner's top bar already
 * says is left out, so the two never repeat each other (the owner's rule:
 * the same thing twice "won't look nice"). Pure, tested
 * (tests/home-screen.test.ts).
 */

export interface TrustInput {
  /** The FSSAI licence number on Business details, or null when not set. */
  readonly fssaiLicence: string | null;
  /** Cash on delivery switched on (Store controls). */
  readonly codEnabled: boolean;
  /** Free delivery from this order value, in rupees; null when delivery is always free or never. */
  readonly freeDeliveryAbove: number | null;
}

export interface TrustFact {
  readonly id: "fssai" | "cod" | "free-delivery" | "shelf-life" | "batch";
  readonly text: string;
  /** A shorter wording for phones, where two facts share a row. */
  readonly short?: string;
  /** Where the fact can be checked, if anywhere. */
  readonly href?: string;
}

/** What each fact is about, to spot it in the top bar's own words. */
const SAID_ALREADY: Record<TrustFact["id"], RegExp> = {
  fssai: /\bfssai\b/i,
  cod: /cash on delivery|\bcod\b|pay on delivery/i,
  "free-delivery": /free (delivery|shipping)/i,
  "shelf-life": /shelf[- ]life|best[- ]before|fresh(est)? stock/i,
  batch: /\bbatch\b|\/verify|verify your pack/i,
};

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * The facts to show, in order, less any the top bar already mentions. The
 * shelf-life fact is the FSSAI e-commerce rule the basket enforces on every
 * order (at least 30% of shelf life left when it's delivered), so it is
 * always true.
 */
export function trustFacts(input: TrustInput, topBar: readonly string[]): TrustFact[] {
  const facts: TrustFact[] = [];
  if (input.fssaiLicence) facts.push({ id: "fssai", text: "FSSAI licensed" });
  if (input.codEnabled) facts.push({ id: "cod", text: "Cash on delivery" });
  if (input.freeDeliveryAbove != null && input.freeDeliveryAbove > 0) facts.push({ id: "free-delivery", text: `Free delivery over ${rupees(input.freeDeliveryAbove)}` });
  facts.push({ id: "shelf-life", text: "Every pack ships with 30%+ of its shelf life left", short: "30%+ shelf life left" });
  facts.push({ id: "batch", text: "Check your pack’s batch", short: "Check your batch", href: "/verify" });
  const said = topBar.join(" · ");
  return facts.filter((f) => !SAID_ALREADY[f.id].test(said));
}
