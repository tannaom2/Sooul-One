/**
 * Structure/function vs. therapeutic claims guardrail — build prompt
 * Sections 2.3, 7.5 and 8.5.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND EMPHATICALLY IS NOT
 * ---------------------------------------------------------------------------
 * FSSAI permits a health supplement to claim it *supports* a function. It does
 * not permit a claim to *treat*, *cure*, *prevent* or *reverse* a condition —
 * that language belongs to a drug licence under CDSCO, which a food-category
 * licence is not.
 *
 * SooulOne is unusually exposed to this line because several category names
 * name a condition directly: Hair Fall, PMS & Menopause, Stress Relief,
 * Digestive Gummies, Immunity. Those names are lawful as category labels. The
 * risk is one well-meaning sentence of product copy away.
 *
 * This linter is a cheap forcing function against the most likely mistake. It
 * is a string matcher. It cannot read intent, it will miss novel phrasings, and
 * a clean result is NOT a legal opinion or a substitute for review by someone
 * qualified. It is deliberately tuned to over-flag rather than under-flag,
 * because a false positive costs an author ten seconds and a false negative
 * costs a regulatory finding.
 */

export type ClaimSeverity = "BLOCK" | "WARN";

export interface ClaimFinding {
  readonly severity: ClaimSeverity;
  readonly matchedText: string;
  readonly index: number;
  readonly explanation: string;
  readonly suggestion?: string;
}

export interface ClaimLintResult {
  readonly findings: readonly ClaimFinding[];
  /** True when nothing at BLOCK severity was found. */
  readonly passesAutomatedCheck: boolean;
  readonly blockingCount: number;
  readonly warningCount: number;
}

interface Rule {
  readonly pattern: RegExp;
  readonly severity: ClaimSeverity;
  readonly explanation: string;
  readonly suggestion?: string;
}

/**
 * Verbs that assert a therapeutic effect. These are the bright line.
 *
 * Matched with word boundaries and common inflections so "cures", "curing" and
 * "cured" are all caught without also matching "curing salt" style false
 * friends in True Store food copy — hence the supplement-only default scope.
 */
const THERAPEUTIC_VERBS: Rule[] = [
  {
    pattern: /\b(treats?|treating|treatment for)\b/gi,
    severity: "BLOCK",
    explanation: "Asserts a therapeutic effect; permitted only under a drug licence.",
    suggestion: "supports",
  },
  {
    pattern: /\b(cures?|curing|cured)\b/gi,
    severity: "BLOCK",
    explanation: "A cure claim is never permissible for a food-category product.",
    suggestion: "helps maintain",
  },
  {
    pattern: /\b(prevents?|preventing|prevention of)\b/gi,
    severity: "BLOCK",
    explanation: "Prevention of a condition is a therapeutic claim.",
    suggestion: "helps support",
  },
  {
    pattern: /\b(reverses?|reversing|reversal of)\b/gi,
    severity: "BLOCK",
    explanation: "Reversal of a condition is a therapeutic claim.",
    suggestion: "helps support",
  },
  {
    pattern: /\b(heals?|healing)\b/gi,
    severity: "BLOCK",
    explanation: "Healing language implies a therapeutic effect.",
    suggestion: "supports",
  },
  {
    pattern: /\b(diagnos(e|es|ing|is))\b/gi,
    severity: "BLOCK",
    explanation: "Diagnosis is a clinical act and cannot be claimed by a product.",
  },
  {
    pattern: /\b(remed(y|ies)|therapeutic|medicinal|medicine)\b/gi,
    severity: "BLOCK",
    explanation: "Positions the product as a medicine rather than a food supplement.",
  },
  {
    pattern: /\b(eliminates?|eradicates?|stops?|fixes?|gets? rid of)\b/gi,
    severity: "BLOCK",
    explanation:
      "Absolute-outcome language reads as a therapeutic promise, particularly next to a condition name.",
    suggestion: "helps reduce the appearance of",
  },
];

/** Phrasings that are not automatically unlawful but very often become so. */
const HIGH_RISK_PHRASES: Rule[] = [
  {
    pattern: /\b(clinically proven|scientifically proven|doctor[- ]?approved|proven to)\b/gi,
    severity: "WARN",
    explanation:
      "Proof language requires substantiation on file and is a common trigger for a claims challenge.",
  },
  {
    pattern: /\b(guarantee[ds]?|100% ?(effective|results)|permanent(ly)?)\b/gi,
    severity: "WARN",
    explanation: "Outcome guarantees are not substantiable for a supplement.",
  },
  {
    pattern: /\b(instant(ly)?|overnight|in (just )?\d+ days?)\b/gi,
    severity: "WARN",
    explanation: "Speed-of-result claims require substantiation and invite scrutiny.",
  },
  {
    pattern: /\b(disease|disorder|syndrome|deficiency|illness|condition)\b/gi,
    severity: "WARN",
    explanation:
      "Naming a pathology in benefit copy moves it toward a therapeutic claim even without a therapeutic verb.",
  },
  {
    pattern: /\b(replaces? (your )?(medication|prescription)|no need for (a )?doctor)\b/gi,
    severity: "WARN",
    explanation: "Discouraging medical care is a serious consumer-safety issue as well as a claims issue.",
  },
];

/**
 * Named conditions, flagged wherever they appear in copy.
 *
 * This is the rule SooulOne specifically needs. Several category names are
 * condition names — Hair Fall, PMS & Menopause — and Section 8.5 is clear that
 * this is lawful *as a label* while the copy around it is where the risk sits.
 * "Supports hair health" is fine; "helps with your hair fall" is already
 * leaning on the condition rather than the function.
 *
 * WARN rather than BLOCK, because naming a condition is not itself unlawful —
 * it is a signal that the sentence deserves a second read. Pass the brand's own
 * category names via `allowedPhrases` so navigation and breadcrumbs stay quiet.
 *
 * Deliberately excludes "immunity", "energy", "sleep" and "stress": those name
 * bodily functions rather than pathologies, and "supports immunity" is the
 * textbook lawful structure/function claim. Flagging them would bury the real
 * signals in noise.
 */
const CONDITION_TERMS: Rule[] = [
  {
    pattern:
      /\b(hair ?fall|hair loss|alopecia|balding)\b/gi,
    severity: "WARN",
    explanation:
      "Names a condition. Keep the surrounding sentence on function (\"supports hair strength\") rather than on the condition itself.",
    suggestion: "supports hair health",
  },
  {
    pattern: /\b(pms|premenstrual|menopaus(e|al)|perimenopaus(e|al))\b/gi,
    severity: "WARN",
    explanation:
      "Names a life stage or condition frequently read as a therapeutic target. Confirm the sentence claims support, not relief of symptoms.",
  },
  {
    pattern: /\b(pcos|pcod)\b/gi,
    severity: "WARN",
    explanation: "A diagnosed condition. Copy must not imply management or treatment of it.",
  },
  {
    pattern: /\b(insomnia|sleeplessness)\b/gi,
    severity: "WARN",
    explanation: 'A clinical sleep disorder. "Supports restful sleep" is the safer construction.',
    suggestion: "supports restful sleep",
  },
  {
    pattern: /\b(anxiety|depression|depressive)\b/gi,
    severity: "WARN",
    explanation:
      "Mental-health conditions carry heightened claim risk and should not appear in supplement benefit copy.",
  },
  {
    pattern: /\b(obesity|obese)\b/gi,
    severity: "WARN",
    explanation: 'A clinical diagnosis. Use "supports weight management" instead.',
    suggestion: "supports weight management",
  },
  {
    pattern: /\b(acne|eczema|psoriasis)\b/gi,
    severity: "WARN",
    explanation: "A dermatological condition; treating it is outside a food-category licence.",
  },
  {
    pattern: /\b(constipation|ibs|irritable bowel|acid reflux)\b/gi,
    severity: "WARN",
    explanation: 'A gastrointestinal condition. "Supports digestive comfort" is the safer construction.',
    suggestion: "supports digestive comfort",
  },
];

const ALL_RULES: Rule[] = [...THERAPEUTIC_VERBS, ...HIGH_RISK_PHRASES, ...CONDITION_TERMS];

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface LintOptions {
  /**
   * Phrases exempt from matching — pass the brand's own category names here.
   * Section 8.5 is explicit that "Hair Fall" and "PMS & Menopause" are lawful
   * as category labels; without this the linter would flag a brand for using
   * its own navigation, and a linter that cries wolf gets switched off.
   */
  readonly allowedPhrases?: readonly string[];
}

/**
 * Lint a piece of supplement-facing copy.
 *
 * Intended for `Product.description`, `shortDescription` and quiz-result copy
 * on HEALTH_SUPPLEMENT products. Not applied to PACKAGED_FOOD copy by default,
 * where several of these words are ordinary food vocabulary.
 */
export function lintSupplementCopy(copy: string, options: LintOptions = {}): ClaimLintResult {
  const findings: ClaimFinding[] = [];

  // Blank out allowed phrases with same-length filler so match indices stay
  // true to the original string for editor highlighting.
  let scannable = copy;
  for (const phrase of options.allowedPhrases ?? []) {
    if (!phrase.trim()) continue;
    scannable = scannable.replace(
      new RegExp(escapeRegExp(phrase), "gi"),
      (m) => "\u0000".repeat(m.length),
    );
  }

  for (const rule of ALL_RULES) {
    // Fresh regex per pass: the rules carry /g, and a shared lastIndex between
    // calls would silently skip matches.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(scannable)) !== null) {
      findings.push({
        severity: rule.severity,
        matchedText: copy.slice(match.index, match.index + match[0].length),
        index: match.index,
        explanation: rule.explanation,
        suggestion: rule.suggestion,
      });
      if (match[0].length === 0) re.lastIndex++; // guard against zero-width loops
    }
  }

  findings.sort((a, b) => a.index - b.index);

  const blockingCount = findings.filter((f) => f.severity === "BLOCK").length;

  return {
    findings,
    passesAutomatedCheck: blockingCount === 0,
    blockingCount,
    warningCount: findings.length - blockingCount,
  };
}

/**
 * The disclaimer every HEALTH_SUPPLEMENT product page must carry (Section 7.1).
 *
 * Adapted to name FSSAI rather than a foreign regulator — the familiar
 * "not evaluated by the FDA" wording is the US construction and is meaningless,
 * arguably misleading, on an Indian listing.
 *
 * Wording is a legal artefact: confirm it with counsel before launch rather
 * than treating this constant as settled (Section 14).
 */
export const SUPPLEMENT_DISCLAIMER =
  "This product is a health supplement and is not intended to diagnose, treat, cure or " +
  "prevent any disease. It is not a substitute for a balanced diet or for medical advice. " +
  "Do not exceed the recommended daily dose. Keep out of reach of children. " +
  "Consult a qualified healthcare professional before use if you are pregnant, breastfeeding, " +
  "or taking prescribed medication.";
