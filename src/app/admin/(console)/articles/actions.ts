"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { CONTENT_TAG, expireTag } from "@/lib/cache-tags";
import { articleSchema } from "@/lib/validation/site-content";
import { lintSupplementCopy } from "@/lib/compliance/claims";
import { plainText } from "@/lib/mini-markdown";

export interface ArticleResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Claims-check findings on a supplement-brand article. */
  findings?: { severity: "BLOCK" | "WARN"; text: string; explanation: string; suggestion?: string }[];
}

const SUPPLEMENT_BRANDS = new Set(["woman-axis", "kids-vault", "man-rituals"]);

/**
 * Save a /learn article. Articles about a supplement brand go through the
 * same claims check as supplement product copy (src/lib/compliance/claims.ts):
 * anything at BLOCK severity stops it being published, and publishing needs
 * a person's sign-off, which a change to the words clears.
 */
export async function saveArticle(_prev: ArticleResult, form: FormData): Promise<ArticleResult> {
  const session = await requirePermission("content:write");
  if (!session) return { ok: false, message: "Your role can't edit articles." };

  const id = String(form.get("id") ?? "") || null;
  const field = (n: string) => String(form.get(n) ?? "");
  const parsed = articleSchema.safeParse({
    title: field("title"),
    slug: field("slug"),
    excerpt: field("excerpt"),
    body: field("body"),
    pillar: field("pillar"),
    brandId: field("brandId"),
    coverImageUrl: field("coverImageUrl"),
    productIds: form.getAll("productIds").map(String),
    published: form.get("published") === "on",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const a = parsed.data;
  const reviewedNow = form.get("reviewed") === "on";

  const [brand, clash, before] = await Promise.all([
    a.brandId ? db.brand.findUnique({ where: { id: a.brandId }, select: { slug: true, categories: { select: { name: true } } } }) : null,
    db.article.findUnique({ where: { slug: a.slug }, select: { id: true } }),
    id ? db.article.findUnique({ where: { id } }) : null,
  ]);
  if (id && !before) return { ok: false, message: "That article was deleted. Reload the page." };
  if (a.brandId && !brand) return { ok: false, message: "That brand no longer exists.", fieldErrors: { brandId: "Pick a brand again." } };
  if (clash && clash.id !== id) return { ok: false, message: "Another article already uses that web address.", fieldErrors: { slug: "Already used. Change the title or the address." } };

  const supplement = brand ? SUPPLEMENT_BRANDS.has(brand.slug) : false;
  let findings: ArticleResult["findings"] = [];
  if (supplement) {
    const lint = lintSupplementCopy(`${a.title}\n${a.excerpt}\n${plainText(a.body)}`, { allowedPhrases: brand!.categories.map((c) => c.name) });
    findings = lint.findings.map((f) => ({ severity: f.severity, text: f.matchedText, explanation: f.explanation, suggestion: f.suggestion }));
    if (a.published && lint.blockingCount > 0) {
      return { ok: false, message: "This can't be published until the flagged claims are reworded.", findings };
    }
  }

  // Sign-off: kept while the words don't change; given again by ticking the box.
  const wordsChanged = !before || before.title !== a.title || before.excerpt !== a.excerpt || before.body !== a.body;
  const review = reviewedNow
    ? { complianceReviewedAt: new Date(), complianceReviewedBy: session.email }
    : wordsChanged
      ? { complianceReviewedAt: null, complianceReviewedBy: null }
      : {};
  const signedOff = reviewedNow || (!wordsChanged && Boolean(before?.complianceReviewedAt));
  if (supplement && a.published && !signedOff) {
    return { ok: false, message: "A supplement-brand article needs a person's sign-off before it goes live. Read it for claims, then tick the box.", findings };
  }

  const { productIds, ...fields } = a;
  const data = {
    ...fields,
    ...review,
    publishedAt: a.published ? (before?.publishedAt ?? new Date()) : before?.publishedAt ?? null,
    products: { set: productIds.map((pid) => ({ id: pid })) },
  };

  let savedId = id;
  if (id) {
    await db.article.update({ where: { id }, data });
    await audit(session, "UPDATE_ARTICLE", "Article", id, { title: a.title, published: { from: before!.published, to: a.published }, wordsChanged });
  } else {
    const created = await db.article.create({ data: { ...fields, ...review, publishedAt: a.published ? new Date() : null, products: { connect: productIds.map((pid) => ({ id: pid })) } } });
    savedId = created.id;
    await audit(session, "ADD_ARTICLE", "Article", created.id, { title: a.title, published: a.published });
  }
  expireTag(CONTENT_TAG);
  revalidatePath("/admin/articles");
  if (!id) redirect(`/admin/articles/${savedId}?saved=1`);
  return { ok: true, message: a.published ? "Saved and live on /learn." : "Saved as a draft.", findings };
}

export async function deleteArticle(id: string): Promise<void> {
  const session = await requirePermission("content:write");
  if (!session) throw new Error("Not authorized.");
  const row = await db.article.findUnique({ where: { id }, select: { title: true } });
  if (!row) return;
  await db.article.delete({ where: { id } });
  await audit(session, "DELETE_ARTICLE", "Article", id, row);
  expireTag(CONTENT_TAG);
  revalidatePath("/admin/articles");
  redirect("/admin/articles");
}
