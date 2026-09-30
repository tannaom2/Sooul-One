import { z } from "zod";
import { ARTICLE_PILLARS, FAQ_TOPICS, SITE_TEXT, SITE_TEXT_KEYS, safeInternalHref, slugify, unknownTokens } from "@/lib/site-content";
import { parseDomain } from "@/lib/brand-domains";

/**
 * What the console's site-content editors and the storefront contact forms
 * accept. Shared by the Server Actions and the tests.
 */

const trimmed = (max: number) => z.string().trim().max(max, `At most ${max} characters.`);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters.`)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const tokensKnown = (text: string, ctx: z.RefinementCtx, path: string) => {
  const unknown = unknownTokens(text);
  if (unknown.length) ctx.addIssue({ code: "custom", path: [path], message: `Unknown ${unknown.length === 1 ? "token" : "tokens"}: ${unknown.map((t) => `{${t}}`).join(", ")}.` });
};

/* ------------------------------------------------------------- top bar */

export const announcementSchema = z
  .object({
    text: trimmed(90).min(1, "Write the message."),
    href: optional(200),
    enabled: z.boolean(),
  })
  .superRefine((a, ctx) => {
    tokensKnown(a.text, ctx, "text");
    if (a.href && !safeInternalHref(a.href)) ctx.addIssue({ code: "custom", path: ["href"], message: "A link must be a path on this site, like /policies/shipping." });
  });

/* ------------------------------------------------------------ site text */

export function siteTextSchema() {
  return z
    .object(Object.fromEntries(SITE_TEXT_KEYS.map((k) => [k, z.string().trim().max(SITE_TEXT[k].max, `At most ${SITE_TEXT[k].max} characters.`)])))
    .superRefine((values, ctx) => {
      for (const k of SITE_TEXT_KEYS) tokensKnown(String(values[k] ?? ""), ctx, k);
    });
}

/* ------------------------------------------------------------------ FAQ */

export const faqSchema = z
  .object({
    question: trimmed(200).min(5, "Write the question."),
    answer: trimmed(2000).min(5, "Write the answer."),
    topic: z.enum(Object.keys(FAQ_TOPICS) as [string, ...string[]], { message: "Pick a topic." }),
    brandId: optional(40),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
    published: z.boolean(),
  })
  .superRefine((f, ctx) => {
    tokensKnown(f.question, ctx, "question");
    tokensKnown(f.answer, ctx, "answer");
    // A starter draft still says what to write; publishing it would show that to shoppers.
    if (f.published && /^DRAFT:/i.test(f.answer)) ctx.addIssue({ code: "custom", path: ["answer"], message: "Replace the DRAFT note with your answer before publishing." });
  });

/* -------------------------------------------------------------- careers */

export const jobSchema = z
  .object({
    title: trimmed(120).min(2, "Give the role a title."),
    team: optional(80),
    location: trimmed(120).min(2, "Where is the role based?"),
    employmentType: trimmed(60).min(2, "Full-time, part-time, internship…"),
    summary: trimmed(1500).min(10, "Describe the role in a few lines."),
    applyUrl: optional(300),
    applyEmail: optional(200),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
    published: z.boolean(),
  })
  .superRefine((j, ctx) => {
    if (j.applyUrl && !/^https:\/\/[^\s]+$/i.test(j.applyUrl)) ctx.addIssue({ code: "custom", path: ["applyUrl"], message: "Use a full https:// link." });
    if (j.applyEmail && !z.string().email().safeParse(j.applyEmail).success) ctx.addIssue({ code: "custom", path: ["applyEmail"], message: "Enter a valid email address." });
    if (!j.applyUrl && !j.applyEmail) ctx.addIssue({ code: "custom", path: ["applyEmail"], message: "Give a link or an email address to apply to." });
  });

/* -------------------------------------------------------------- articles */

export const articleSchema = z
  .object({
    title: trimmed(140).min(5, "Give the article a title."),
    slug: z.string().trim().max(80).optional(),
    excerpt: trimmed(300).min(10, "Write a one- or two-line summary."),
    body: trimmed(40_000).min(50, "The article needs a body."),
    pillar: z.enum(Object.keys(ARTICLE_PILLARS) as [string, ...string[]], { message: "Pick a pillar." }),
    brandId: optional(40),
    coverImageUrl: optional(500),
    productIds: z.array(z.string().max(40)).max(8, "Link at most 8 products."),
    published: z.boolean(),
  })
  .transform((a) => ({ ...a, slug: slugify(a.slug || a.title) }))
  .superRefine((a, ctx) => {
    if (a.slug.length < 3) ctx.addIssue({ code: "custom", path: ["slug"], message: "The web address needs at least 3 letters or digits." });
    // The storefront's security policy loads images from Cloudinary only (src/lib/csp.ts).
    if (a.coverImageUrl && !/^https:\/\/res\.cloudinary\.com\/[^\s]+$/i.test(a.coverImageUrl)) ctx.addIssue({ code: "custom", path: ["coverImageUrl"], message: "Use a Cloudinary image link (https://res.cloudinary.com/…)." });
  });

/* ---------------------------------------------------------------- brands */

/** A full https link on one of these sites (or their subdomains, like www.). */
export function isSocialUrl(value: string, hosts: readonly string[]): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const socialUrl = (hosts: readonly string[]) => optional(300).refine((v) => !v || isSocialUrl(v, hosts), `Use a full https:// link on ${hosts[0]}.`);

export const SOCIAL_FIELDS = [
  { name: "instagramUrl", label: "Instagram", hosts: ["instagram.com"] },
  { name: "facebookUrl", label: "Facebook", hosts: ["facebook.com", "fb.com"] },
  { name: "xUrl", label: "X (Twitter)", hosts: ["x.com", "twitter.com"] },
  { name: "youtubeUrl", label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
] as const;

export const socialSchema = z.object(Object.fromEntries(SOCIAL_FIELDS.map((f) => [f.name, socialUrl(f.hosts)])) as Record<(typeof SOCIAL_FIELDS)[number]["name"], ReturnType<typeof socialUrl>>);

export const brandSettingsSchema = z
  .object({
    tagline: optional(120),
    description: optional(400),
    domain: optional(260),
    domainMode: z.enum(["OFF", "REDIRECT", "STANDALONE"]),
  })
  .extend(socialSchema.shape)
  .transform((b, ctx) => {
    const domain = b.domain ? parseDomain(b.domain) : null;
    if (b.domain && !domain) ctx.addIssue({ code: "custom", path: ["domain"], message: "Enter a domain like womanaxis.in." });
    if (b.domainMode !== "OFF" && !b.domain) ctx.addIssue({ code: "custom", path: ["domain"], message: "Add the domain before switching it on." });
    return { ...b, domain };
  });

/* -------------------------------------------------------- contact forms */

export const ENQUIRY_KINDS = {
  COLLABORATION: "Collaboration",
  INTERNATIONAL: "Delivery outside India",
  GENERAL: "Something else",
} as const;

export const enquirySchema = z
  .object({
    kind: z.enum(["COLLABORATION", "INTERNATIONAL", "GENERAL"]),
    name: trimmed(100).min(2, "Tell us your name.").refine((v) => !/[\r\n\t]/.test(v), "Your name on one line, please."),
    email: z.string().trim().toLowerCase().max(200).email("Enter a valid email address."),
    phone: optional(20).refine((v) => !v || /^\+?[\d\s-]{8,20}$/.test(v), "Enter a phone number, or leave it empty."),
    organisation: optional(120),
    country: optional(80),
    message: trimmed(2000).min(10, "Tell us a little more (at least 10 characters)."),
  })
  .superRefine((e, ctx) => {
    if (e.kind === "INTERNATIONAL" && !e.country) ctx.addIssue({ code: "custom", path: ["country"], message: "Which country should we deliver to?" });
  });

export type EnquiryInput = z.infer<typeof enquirySchema>;
