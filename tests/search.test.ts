import { describe, expect, it } from "vitest";
import { groupByBrand, queryForLog, rank, tokenize, withinOneEdit } from "@/lib/search";
import { verifyResult, normalizeBatch, validBatch, batchStatus } from "@/lib/batch-verify";
import { parseInline, parseMarkdown, plainText, safeHref } from "@/lib/mini-markdown";
import { classifyMessage, matchFaq } from "@/lib/assistant";

/** Storefront search, the batch check, the article format and the assistant's FAQ answers. */

const P = (id: string, name: string, brandSlug: string, brandName: string, category: string, text = "") => ({ id, name, brand: brandName, category, text, brandSlug, brandName });
const CATALOG = [
  P("1", "Biotin Hair Gummies", "woman-axis", "Woman Axis", "Hair", "biotin and zinc"),
  P("2", "Ashwagandha Calm Gummies", "man-rituals", "Man Rituals", "Stress", "ashwagandha ksm-66"),
  P("3", "Masala Makhana", "the-true-store", "The True Store", "Namkeen", "roasted fox nuts"),
  P("4", "Kids Multivitamin Gummies", "kids-vault", "Kids Vault", "Growth", "vitamin d and zinc"),
];

describe("search", () => {
  it("splits a query into meaningful words", () => {
    expect(tokenize("The best Biotin gummies for hair!")).toEqual(["biotin", "gummies", "hair"]);
    expect(tokenize("")).toEqual([]);
  });

  it("forgives one typo on longer words", () => {
    expect(withinOneEdit("ashwagnadha", "ashwagandha")).toBe(true);
    expect(withinOneEdit("makhana", "makhanaa")).toBe(true);
    expect(withinOneEdit("zinc", "iron")).toBe(false);
    expect(rank("ashwagnadha", CATALOG).hits.map((h) => h.id)).toEqual(["2"]);
  });

  it("needs every word to match, and falls back to any word, marked close", () => {
    expect(rank("zinc gummies", CATALOG).hits.map((h) => h.id).sort()).toEqual(["1", "4"]);
    const close = rank("zinc chocolate", CATALOG);
    expect(close.close).toBe(true);
    expect(close.hits.length).toBe(2);
    expect(rank("pizza", CATALOG)).toEqual({ hits: [], close: false });
  });

  it("ranks name matches above description matches", () => {
    expect(rank("biotin", CATALOG).hits[0].id).toBe("1");
  });

  it("finds across brands and puts the one you're browsing first", () => {
    const hits = rank("gummies", CATALOG).hits;
    expect(new Set(hits.map((h) => h.brandSlug)).size).toBe(3);
    expect(groupByBrand(hits, "kids-vault")[0].brandSlug).toBe("kids-vault");
  });

  it("keeps no phone numbers, order numbers or emails in the analytics copy", () => {
    expect(queryForLog("Biotin 9876543210")).toBe("biotin");
    expect(queryForLog("order SO-4412345-AB me@x.com")).toBe("order so- -ab");
    expect(queryForLog("x".repeat(100)).length).toBe(60);
  });
});

describe("batch check", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const batch = { productName: "Biotin Hair Gummies", productSlug: "biotin", brandName: "Woman Axis", batchNumber: "B-2410/07", manufacturedOn: new Date("2026-09-01"), expiresOn: new Date("2027-09-01"), recalledAt: null, recallNote: null };

  it("reads codes the way they're printed, whatever the case or punctuation", () => {
    expect(normalizeBatch(" b-2410/07 ")).toBe("B241007");
    expect(validBatch("B241007")).toBe(true);
    expect(validBatch("AB")).toBe(false);
    expect(validBatch("X".repeat(31))).toBe(false);
  });

  it("says a batch is ours, past its date, or recalled, in that order of importance", () => {
    expect(batchStatus(batch, now)).toBe("good");
    expect(batchStatus({ ...batch, expiresOn: new Date("2026-09-30") }, now)).toBe("expired");
    expect(batchStatus({ ...batch, expiresOn: new Date("2026-09-30"), recalledAt: new Date("2026-09-15") }, now)).toBe("recalled");
  });

  it("never calls a miss a fake: just not found", () => {
    expect(verifyResult("zz", [], now)).toEqual({ kind: "invalid" });
    expect(verifyResult("b 999 999", [], now)).toEqual({ kind: "not-found", batch: "B999999" });
    const found = verifyResult("b241007", [batch], now);
    expect(found.kind === "found" && found.matches[0].status).toBe("good");
  });
});

describe("article format", () => {
  it("parses headings, paragraphs, lists and quotes", () => {
    const blocks = parseMarkdown("## Why sugar matters\n\nMost gummies hide it.\nWe don't.\n\n- 1.5 g a serving\n- no syrup\n\n1. Read the label\n2. Compare\n\n> Label first.");
    expect(blocks.map((b) => b.type)).toEqual(["h2", "p", "ul", "ol", "quote"]);
    expect(blocks[1]).toEqual({ type: "p", content: [{ type: "text", text: "Most gummies hide it. We don't." }] });
  });

  it("makes links only to this site or https, and never passes HTML through", () => {
    expect(safeHref("/product/x")).toBe("/product/x");
    expect(safeHref("https://fssai.gov.in/")).toBe("https://fssai.gov.in/");
    for (const bad of ["javascript:alert(1)", "//evil.example", "http://plain.example", "data:text/html,x"]) expect(safeHref(bad)).toBeNull();
    expect(parseInline("[click](javascript:alert(1))")).toEqual([{ type: "text", text: "[click](javascript:alert(1)" }, { type: "text", text: ")" }]);
    expect(parseInline("<script>alert(1)</script> **bold**")).toEqual([
      { type: "text", text: "<script>alert(1)</script> " },
      { type: "bold", text: "bold" },
    ]);
  });

  it("gives the words without markup, for the claims check", () => {
    expect(plainText("## Title\n\n**Supports** [energy](/x)")).toBe("Title\nSupports energy");
  });
});

describe("storefront assistant", () => {
  it("sends questions about genuine products to the batch check", () => {
    expect(classifyMessage("is this product genuine?")).toBe("verify");
    expect(classifyMessage("how do I check the batch number")).toBe("verify");
    expect(classifyMessage("where is my order")).toBe("track");
    // "How long" is about delivery only when it says so; shelf life goes to the FAQs.
    expect(classifyMessage("how long will delivery take")).toBe("shipping");
    expect(classifyMessage("how long will my product last")).toBe("unknown");
  });

  it("answers from the owner's FAQs only when it's a confident match", () => {
    const faqs = [
      { id: "src", question: "Where do your ingredients come from?", answer: "From farms we visit." },
      { id: "life", question: "How long will my product last?", answer: "Every product page shows the best-before date." },
    ];
    expect(matchFaq("where do the ingredients come from", faqs)?.id).toBe("src");
    expect(matchFaq("how long does it last", faqs)?.id).toBe("life");
    expect(matchFaq("hello there", faqs)).toBeNull();
    expect(matchFaq("", faqs)).toBeNull();
  });
});
