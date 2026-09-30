"use client";

import { useActionState, useState } from "react";
import { keepFormValues } from "@/components/keep-form-values";
import { ARTICLE_PILLARS, slugify } from "@/lib/site-content";
import { FieldError, FormStatus } from "../form-status";
import { deleteArticle, saveArticle, type ArticleResult } from "./actions";

const INITIAL: ArticleResult = { ok: false };
const SUPPLEMENT_BRANDS = new Set(["woman-axis", "kids-vault", "man-rituals"]);

export interface ArticleValues {
  id: string | null;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  pillar: string;
  brandId: string | null;
  coverImageUrl: string | null;
  productIds: string[];
  published: boolean;
  reviewedBy: string | null;
}

export function ArticleForm({
  values,
  brands,
  products,
}: {
  values: ArticleValues;
  brands: { id: string; slug: string; name: string }[];
  products: { id: string; name: string; brandId: string }[];
}) {
  const [state, submit, pending] = useActionState(saveArticle, INITIAL);
  const [brandId, setBrandId] = useState(values.brandId ?? "");
  const [title, setTitle] = useState(values.title);
  const err = state.fieldErrors ?? {};
  const brand = brands.find((b) => b.id === brandId);
  const supplement = brand ? SUPPLEMENT_BRANDS.has(brand.slug) : false;
  const aria = (n: string) => (err[n] ? { "aria-invalid": true, "aria-describedby": `${n}-error` } : {});

  return (
    <form onSubmit={keepFormValues(submit)} className="grid gap-6">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="title">
            Title
          </label>
          <input id="title" name="title" defaultValue={values.title} onChange={(e) => setTitle(e.target.value)} maxLength={140} required className="field" {...aria("title")} />
          <FieldError id="title" message={err.title} />
        </div>
        <div>
          <label className="label" htmlFor="slug">
            Web address
          </label>
          <input id="slug" name="slug" defaultValue={values.slug} placeholder={slugify(title) || "from-the-title"} maxLength={80} className="field" {...aria("slug")} />
          <p className="mt-1 text-micro text-ink-faint">/learn/{values.slug || slugify(title) || "…"}. Leave empty to use the title.</p>
          <FieldError id="slug" message={err.slug} />
        </div>
        <div>
          <label className="label" htmlFor="coverImageUrl">
            Cover image <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <input id="coverImageUrl" name="coverImageUrl" defaultValue={values.coverImageUrl ?? ""} placeholder="https://res.cloudinary.com/…" className="field" {...aria("coverImageUrl")} />
          <FieldError id="coverImageUrl" message={err.coverImageUrl} />
        </div>
        <div>
          <label className="label" htmlFor="brandId">
            Brand
          </label>
          <select id="brandId" name="brandId" value={brandId} onChange={(e) => setBrandId(e.target.value)} className="field">
            <option value="">SooulOne (all brands)</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pillar">
            Pillar
          </label>
          <select id="pillar" name="pillar" defaultValue={values.pillar} className="field">
            {Object.entries(ARTICLE_PILLARS).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
                {p.brand ? ` (${brands.find((b) => b.slug === p.brand)?.name ?? p.brand})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="excerpt">
            Summary
          </label>
          <textarea id="excerpt" name="excerpt" defaultValue={values.excerpt} rows={2} maxLength={300} required className="field" {...aria("excerpt")} />
          <FieldError id="excerpt" message={err.excerpt} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="body">
            Article
          </label>
          <textarea id="body" name="body" defaultValue={values.body} rows={18} maxLength={40000} required className="field font-mono text-small" {...aria("body")} />
          <p className="mt-1 text-micro text-ink-faint">
            ## Heading · ### Subheading · a blank line between paragraphs · - bullet · 1. numbered · &gt; quote · **bold** · [link text](/product/…)
          </p>
          <FieldError id="body" message={err.body} />
        </div>
      </div>

      <fieldset className="border border-rule p-4">
        <legend className="label px-1">Products in this article (up to 8)</legend>
        <div className="grid max-h-60 gap-1 overflow-y-auto sm:grid-cols-2">
          {products
            .filter((p) => !brandId || p.brandId === brandId)
            .map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-small">
                <input type="checkbox" name="productIds" value={p.id} defaultChecked={values.productIds.includes(p.id)} /> {p.name}
              </label>
            ))}
        </div>
        <FieldError id="productIds" message={err.productIds} />
      </fieldset>

      {state.findings && state.findings.length > 0 && (
        <div className="border-l-4 border-alert bg-shelf p-4" role="alert">
          <p className="font-semibold">Claims check</p>
          <ul className="mt-2 grid gap-2 text-small">
            {state.findings.map((f, i) => (
              <li key={i}>
                <span className={f.severity === "BLOCK" ? "font-semibold text-alert" : "font-semibold text-caution"}>{f.severity === "BLOCK" ? "Must change" : "Check"}</span>{" "}
                &ldquo;{f.text}&rdquo;: {f.explanation}
                {f.suggestion ? ` Try: ${f.suggestion}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-2">
        {supplement && (
          <label className="flex items-start gap-2 text-small">
            <input type="checkbox" name="reviewed" className="mt-1" />
            <span>
              I&apos;ve read this for health claims: it says what the products support, never that they treat, cure or prevent anything.
              {values.reviewedBy && <span className="block text-micro text-ink-soft">Last signed off by {values.reviewedBy}; changing the words clears it.</span>}
            </span>
          </label>
        )}
        <label className="flex items-center gap-2 text-small">
          <input type="checkbox" name="published" defaultChecked={values.published} /> Published on /learn
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : "Save article"}
        </button>
        {values.id && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              if (confirm("Delete this article?")) void deleteArticle(values.id!);
            }}
          >
            Delete
          </button>
        )}
        <FormStatus state={state} />
      </div>
    </form>
  );
}
