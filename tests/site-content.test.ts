import { describe, expect, it } from "vitest";
import { fillTokens, groupFaqs, readingMinutes, resolveSiteText, safeInternalHref, SITE_TEXT, slugify, storeFacts, topBarMessages, unknownTokens } from "@/lib/site-content";
import { announcementSchema, articleSchema, brandSettingsSchema, enquirySchema, faqSchema, jobSchema, siteTextSchema } from "@/lib/validation/site-content";

/** Owner-controlled storefront words (src/lib/site-content.ts) and what the editors accept. */

const facts = { freeDelivery: "₹799/-", deliveryFee: "₹59/-", area: "Gujarat" };

describe("store facts in copy", () => {
  it("fills the tokens from the same settings checkout uses", () => {
    const live = storeFacts();
    expect(live.area).toBe("Gujarat");
    expect(live.freeDelivery).toMatch(/^₹\d/);
    expect(fillTokens("Free shipping above {freeDelivery} in {area}", facts)).toBe("Free shipping above ₹799/- in Gujarat");
  });

  it("leaves an unknown token as typed, and the editors refuse to save one", () => {
    expect(fillTokens("Hi {name}", facts)).toBe("Hi {name}");
    expect(unknownTokens("{area} {nme} {freeDelivery}")).toEqual(["nme"]);
    expect(announcementSchema.safeParse({ text: "Free over {freeDelivry}", href: "", enabled: true }).success).toBe(false);
  });
});

describe("top bar", () => {
  const rows = [
    { id: "b", text: "Free shipping above {freeDelivery}", href: null, enabled: true, sortOrder: 1 },
    { id: "a", text: "We only deliver in {area}", href: "/policies/shipping", enabled: true, sortOrder: 0 },
    { id: "c", text: "Hidden", href: null, enabled: false, sortOrder: 2 },
    { id: "d", text: "   ", href: null, enabled: true, sortOrder: 3 },
  ];
  it("shows enabled messages in order, filled in, dropping empty ones", () => {
    expect(topBarMessages(rows, facts)).toEqual([
      { id: "a", text: "We only deliver in Gujarat", href: "/policies/shipping" },
      { id: "b", text: "Free shipping above ₹799/-", href: null },
    ]);
  });

  it("keeps only links to paths on this site", () => {
    expect(safeInternalHref("/policies/shipping#fees")).toBe("/policies/shipping#fees");
    for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/a b", "policies"]) expect(safeInternalHref(bad)).toBeNull();
    expect(announcementSchema.safeParse({ text: "Hi", href: "https://x.com", enabled: true }).success).toBe(false);
  });
});

describe("site text", () => {
  it("starts from the defaults and takes the owner's lines, empty ones included", () => {
    const text = resolveSiteText([
      { key: "contact.hours", value: "10 AM – 7 PM" },
      { key: "contact.responseTime", value: "" },
      { key: "no.such.key", value: "ignored" },
    ]);
    expect(text["contact.hours"]).toBe("10 AM – 7 PM");
    expect(text["contact.responseTime"]).toBe(""); // hidden
    expect(text["verify.intro"]).toBe(SITE_TEXT["verify.intro"].default);
    expect("no.such.key" in text).toBe(false);
  });

  it("keeps the owner's own copy from the brief as the defaults", () => {
    expect(SITE_TEXT["contact.responseTime"].default).toContain("within one hour");
    expect(SITE_TEXT["contact.hours"].default).toBe("9 AM – 6 PM IST, Monday to Saturday");
    expect(SITE_TEXT["verify.intro"].default).toContain("batch number");
  });

  it("checks lengths and tokens", () => {
    const base = Object.fromEntries(Object.entries(SITE_TEXT).map(([k, f]) => [k, f.default]));
    expect(siteTextSchema().safeParse(base).success).toBe(true);
    expect(siteTextSchema().safeParse({ ...base, "contact.hours": "x".repeat(500) }).success).toBe(false);
    expect(siteTextSchema().safeParse({ ...base, "footer.tagline": "Free over {oops}" }).success).toBe(false);
  });
});

describe("FAQs", () => {
  it("groups published FAQs by topic in the topics' order, filled in", () => {
    const groups = groupFaqs(
      [
        { id: "2", question: "What does delivery cost?", answer: "{deliveryFee}, free above {freeDelivery}", topic: "DELIVERY", brandSlug: null, sortOrder: 1 },
        { id: "1", question: "Confirmed?", answer: "Yes", topic: "ORDERS", brandSlug: null, sortOrder: 0 },
        { id: "3", question: "Where?", answer: "{area}", topic: "DELIVERY", brandSlug: null, sortOrder: 0 },
      ],
      facts,
    );
    expect(groups.map((g) => g.topic)).toEqual(["ORDERS", "DELIVERY"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["3", "2"]);
    expect(groups[1].items[1].answer).toBe("₹59/-, free above ₹799/-");
  });

  it("won't publish a starter draft that still says what to write", () => {
    const draft = { question: "Can I return it?", answer: "DRAFT: your return policy", topic: "RETURNS", brandId: "", sortOrder: "0" };
    expect(faqSchema.safeParse({ ...draft, published: false }).success).toBe(true);
    expect(faqSchema.safeParse({ ...draft, published: true }).success).toBe(false);
    expect(faqSchema.safeParse({ ...draft, topic: "NOPE", published: false }).success).toBe(false);
  });
});

describe("articles and careers", () => {
  it("makes a clean web address from the title", () => {
    expect(slugify("Why sugar per serving matters!")).toBe("why-sugar-per-serving-matters");
    expect(slugify("  Ashwagandha & you — a guide  ")).toBe("ashwagandha-you-a-guide");
    const parsed = articleSchema.safeParse({ title: "Reading a label", slug: "", excerpt: "How to read the back of a pack.", body: "x ".repeat(40), pillar: "label-literacy", brandId: "", coverImageUrl: "", productIds: [], published: false });
    expect(parsed.success && parsed.data.slug).toBe("reading-a-label");
  });

  it("takes cover images from Cloudinary only (the site's image policy)", () => {
    const base = { title: "Reading a label", slug: "", excerpt: "How to read the back of a pack.", body: "x ".repeat(40), pillar: "label-literacy", brandId: "", productIds: [], published: false };
    expect(articleSchema.safeParse({ ...base, coverImageUrl: "https://res.cloudinary.com/demo/image/upload/a.jpg" }).success).toBe(true);
    expect(articleSchema.safeParse({ ...base, coverImageUrl: "https://example.com/a.jpg" }).success).toBe(false);
  });

  it("estimates reading time at 200 words a minute, at least one", () => {
    expect(readingMinutes("word ".repeat(1000))).toBe(5);
    expect(readingMinutes("short")).toBe(1);
  });

  it("needs somewhere to apply for a role", () => {
    const role = { title: "Content writer", team: "", location: "Ahmedabad", employmentType: "Full-time", summary: "Write labels people understand.", sortOrder: "0", published: true };
    expect(jobSchema.safeParse({ ...role, applyUrl: "", applyEmail: "" }).success).toBe(false);
    expect(jobSchema.safeParse({ ...role, applyUrl: "", applyEmail: "careers@sooulone.in" }).success).toBe(true);
    expect(jobSchema.safeParse({ ...role, applyUrl: "http://insecure.example", applyEmail: "" }).success).toBe(false);
  });
});

describe("brand settings", () => {
  const base = { tagline: "", description: "", instagramUrl: "", facebookUrl: "", xUrl: "", youtubeUrl: "" };
  it("cleans up the domain and needs one before it's switched on", () => {
    const ok = brandSettingsSchema.safeParse({ ...base, domain: "https://www.WomanAxis.in/", domainMode: "STANDALONE" });
    expect(ok.success && ok.data.domain).toBe("womanaxis.in");
    expect(brandSettingsSchema.safeParse({ ...base, domain: "", domainMode: "REDIRECT" }).success).toBe(false);
    expect(brandSettingsSchema.safeParse({ ...base, domain: "not a domain", domainMode: "OFF" }).success).toBe(false);
  });

  it("takes social links only on their own site, over https", () => {
    expect(brandSettingsSchema.safeParse({ ...base, domain: "", domainMode: "OFF", instagramUrl: "https://www.instagram.com/womanaxis" }).success).toBe(true);
    expect(brandSettingsSchema.safeParse({ ...base, domain: "", domainMode: "OFF", instagramUrl: "https://evil.example/instagram.com" }).success).toBe(false);
    expect(brandSettingsSchema.safeParse({ ...base, domain: "", domainMode: "OFF", youtubeUrl: "http://youtube.com/x" }).success).toBe(false);
  });
});

describe("contact form", () => {
  const msg = { kind: "COLLABORATION", name: "Asha Patel", email: "Asha@Example.com", phone: "", organisation: "", country: "", message: "We'd like to stock your namkeen." };
  it("accepts a message and tidies the email", () => {
    const parsed = enquirySchema.safeParse(msg);
    expect(parsed.success && parsed.data.email).toBe("asha@example.com");
  });

  it("asks which country for a delivery outside India", () => {
    expect(enquirySchema.safeParse({ ...msg, kind: "INTERNATIONAL" }).success).toBe(false);
    expect(enquirySchema.safeParse({ ...msg, kind: "INTERNATIONAL", country: "UAE" }).success).toBe(true);
  });

  it("refuses a name with line breaks (it goes into an email subject)", () => {
    expect(enquirySchema.safeParse({ ...msg, name: "Asha\r\nBcc: x@y.z" }).success).toBe(false);
    expect(enquirySchema.safeParse({ ...msg, message: "short" }).success).toBe(false);
  });
});
