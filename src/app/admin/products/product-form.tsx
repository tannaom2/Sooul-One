"use client";

import { useActionState, useMemo, useState } from "react";
import { saveProduct, type ActionResult } from "../actions";
import { lintSupplementCopy } from "@/lib/compliance/claims";
import { ImageUpload } from "@/components/image-upload";
import { keepFormValues } from "@/components/keep-form-values";

/**
 * The product form.
 *
 * Section 7.5 is explicit: "Don't build one generic form with every field
 * optional — that's how a mandatory allergen field quietly ships blank." So
 * choosing a regulatory type genuinely changes which fields exist, not merely
 * which are starred. Nutrition and supplement facts are never both on screen.
 *
 * The claims check runs live as the description is typed, because telling a
 * writer their sentence is unlawful after they hit save is far too late to be
 * useful.
 */

type Type = "PACKAGED_FOOD" | "HEALTH_SUPPLEMENT" | "BEVERAGE";

interface Brand {
  id: string;
  name: string;
  slug: string;
  categories: { id: string; name: string }[];
}

const NUTRIENTS: [key: string, label: string, unit: string][] = [
  ["servingSizeG", "Serving size", "g"],
  ["energyKcal", "Energy", "kcal"],
  ["proteinG", "Protein", "g"],
  ["carbohydrateG", "Carbohydrate", "g"],
  ["totalSugarsG", "of which sugars", "g"],
  ["totalFatG", "Total fat", "g"],
  ["saturatedFatG", "of which saturates", "g"],
  ["transFatG", "Trans fat", "g"],
  ["fibreG", "Dietary fibre", "g"],
  ["sodiumMg", "Sodium", "mg"],
];

const INITIAL: ActionResult = { ok: false };

export function ProductForm({
  brands,
  product,
  canEditPricing = true,
}: {
  brands: Brand[];
  product?: any;
  /** False for copy editors: prices show read-only (still submitted, so the server can confirm they didn't change). */
  canEditPricing?: boolean;
}) {
  const locked = !canEditPricing;
  const [state, submit, pending] = useActionState(saveProduct, INITIAL);

  const [type, setType] = useState<Type>(product?.regulatoryType ?? "PACKAGED_FOOD");
  const [brandId, setBrandId] = useState<string>(product?.brandId ?? brands[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState<string>(product?.categoryId ?? "");
  const [description, setDescription] = useState<string>(product?.description ?? "");
  const [nutrition, setNutrition] = useState<Record<string, string>>(() => {
    const source = product?.nutritionFacts ?? {};
    return Object.fromEntries(NUTRIENTS.map(([k]) => [k, source[k] ?? ""]));
  });
  const [discountOn, setDiscountOn] = useState<boolean>(Boolean(product?.discountActive));
  const [discountPct, setDiscountPct] = useState<string>(product?.discountPercent?.toString() ?? "");
  const [facts, setFacts] = useState(
    product?.supplementFacts ?? [{ ingredient: "", amountPerServing: "", percentRDA: null }],
  );

  /**
   * Memoised on the values it is actually derived from.
   *
   * Written inline, `categories` was a fresh array on every render — `.find()`
   * returning undefined falls through to a new `[]` literal each time — which
   * defeated the `categoryNames` memo below it, which in turn defeated the
   * `lint` memo, so the claims linter re-ran on every unrelated render rather
   * than only when the copy changed.
   */
  const categories = useMemo(
    () => brands.find((b) => b.id === brandId)?.categories ?? [],
    [brands, brandId],
  );
  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories]);

  // Category names are lawful as labels, so they must not trip the linter.
  const lint = useMemo(
    () =>
      type === "HEALTH_SUPPLEMENT"
        ? lintSupplementCopy(description, { allowedPhrases: categoryNames })
        : null,
    [description, type, categoryNames],
  );

  const err = (field: string) => state.fieldErrors?.[field]?.[0];

  return (
    <form onSubmit={keepFormValues(submit)} className="grid max-w-3xl gap-6">
      {product?.id && <input type="hidden" name="id" value={product.id} />}
      {/* Which version of the product this form was loaded from, so a save
          can't silently overwrite someone else's change made in the meantime. */}
      {product?.id && (
        <input type="hidden" name="loadedVersion" value={state.version ?? new Date(product.updatedAt).toISOString()} />
      )}
      <input type="hidden" name="nutritionFacts" value={JSON.stringify(
        Object.fromEntries(
          Object.entries(nutrition)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, Number(v)]),
        ),
      )} />
      <input type="hidden" name="supplementFacts" value={JSON.stringify(facts)} />
      <input type="hidden" name="description" value={description} />

      {/* --- What kind of product is this? Decides the whole form. --- */}
      <fieldset className="panel p-4">
        <legend className="label px-1">What kind of product is this?</legend>
        <div className="grid gap-2">
          {(
            [
              ["PACKAGED_FOOD", "Packaged food — namkeen, sweets, munchies"],
              ["HEALTH_SUPPLEMENT", "Health supplement — gummies"],
              ["BEVERAGE", "Beverage"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="regulatoryType"
                value={value}
                checked={type === value}
                onChange={() => setType(value)}
              />
              <span className="text-small">{label}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-micro text-ink-faint">
          This decides which label information the law requires, so the rest of this form changes
          with it.
        </p>
      </fieldset>

      {/* --- Identity --- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product name" name="name" defaultValue={product?.name} error={err("name")} />
        <Field label="Web address (slug)" name="slug" defaultValue={product?.slug} error={err("slug")} />
        <Field label="SKU" name="sku" defaultValue={product?.sku} error={err("sku")} />
        <Field label="HSN code" name="hsnCode" defaultValue={product?.hsnCode} error={err("hsnCode")} hint="Required to go live; printed on the GST invoice." />

        <div>
          <label className="label" htmlFor="brandId">Brand</label>
          <select
            id="brandId"
            name="brandId"
            className="field"
            value={brandId}
            onChange={(e) => {
              const nextBrandId = e.target.value;
              setBrandId(nextBrandId);
              // The category list is brand-specific, so a category chosen under
              // the old brand cannot carry over — that's how a product used to
              // end up with a brand and category from two different brands.
              const nextCategories = brands.find((b) => b.id === nextBrandId)?.categories ?? [];
              setCategoryId(nextCategories[0]?.id ?? "");
            }}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="categoryId">Category</label>
          <select
            id="categoryId"
            name="categoryId"
            className="field"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {err("categoryId") && <Err>{err("categoryId")}</Err>}
        </div>
      </div>

      <Field label="One-line description" name="shortDescription" defaultValue={product?.shortDescription} error={err("shortDescription")} />

      {/* --- Description, with the live claims check for supplements --- */}
      <div>
        <label className="label" htmlFor="description">Full description</label>
        <textarea
          id="description"
          rows={6}
          className="field"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {err("description") && <Err>{err("description")}</Err>}

        {lint && description.length > 0 && (
          // aria-live: this updates live as the admin types, with no submit
          // action to hang an announcement off — a screen reader user needs
          // to hear about a claims-linter warning the same way a sighted
          // admin sees it appear.
          <div className="mt-2 text-small" aria-live="polite" role="status">
            {lint.findings.length === 0 ? (
              <p className="text-veg">No claim problems found.</p>
            ) : (
              <ul className="grid gap-1">
                {lint.findings.map((f, i) => (
                  <li
                    key={`${f.index}-${i}`}
                    style={{ color: f.severity === "BLOCK" ? "var(--color-alert)" : "var(--color-caution)" }}
                  >
                    <strong>{f.matchedText}</strong> — {f.explanation}
                    {f.suggestion && <> Try &ldquo;{f.suggestion}&rdquo;.</>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-micro text-ink-faint">
              This check catches common mistakes. It is not legal approval.
            </p>
          </div>
        )}
      </div>

      {/* --- Pricing and stock --- */}
      {locked && (
        <p className="border-l-4 border-caution bg-shelf p-3 text-small">
          Price, was-price, GST and discount can only be changed by the owner or a manager.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="MRP (₹, as printed)" name="mrp" defaultValue={product?.mrp?.toString()} error={err("mrp")} hint="Required to go live. Nothing can sell above it." readOnly={locked} />
        <Field label="Price (₹, incl. GST)" name="basePrice" defaultValue={product?.basePrice?.toString()} error={err("basePrice")} readOnly={locked} />
        <Field label="Was-price (₹)" name="compareAtPrice" defaultValue={product?.compareAtPrice?.toString()} error={err("compareAtPrice")} optional readOnly={locked} />
        <Field label="GST rate (%)" name="taxRatePercent" type="number" defaultValue={product?.taxRatePercent?.toString() ?? "18"} error={err("taxRatePercent")} readOnly={locked} />
        <Field label="Online stock" name="stockQuantity" type="number" defaultValue={String(product?.stockQuantity ?? 0)} />
        <Field label="Reorder at" name="lowStockThreshold" type="number" defaultValue={String(product?.lowStockThreshold ?? 10)} />
        <Field label="Pack weight (g)" name="weightGrams" type="number" defaultValue={product?.weightGrams?.toString()} optional />
      </div>

      {/* --- Discount promotion --- */}
      <fieldset className="panel p-4">
        <legend className="label px-1">Discount</legend>
        <label className="flex items-center gap-3 text-small">
          <input
            type="checkbox"
            name="discountActive"
            checked={discountOn}
            onChange={(e) => setDiscountOn(e.target.checked)}
            disabled={locked}
          />
          {/* A disabled checkbox isn't submitted, so carry its value. */}
          {locked && discountOn && <input type="hidden" name="discountActive" value="on" />}
          <span>Discount is active</span>
        </label>
        <div className="mt-3 max-w-[16rem]">
          <label className="label" htmlFor="discountPercent">Discount (%)</label>
          <input
            id="discountPercent"
            name="discountPercent"
            type="number"
            step="0.01"
            min="0"
            max="99.99"
            className="field tabular"
            value={discountPct}
            onChange={(e) => setDiscountPct(e.target.value)}
            readOnly={locked}
            aria-readonly={locked || undefined}
          />
          {err("discountPercent") && <Err>{err("discountPercent")}</Err>}
        </div>
        <p className="mt-3 text-micro text-ink-faint">
          The price above is the undiscounted price. When active, shoppers see it struck through
          next to the discounted price, e.g. 500/- then 470/- at 6%.
        </p>
      </fieldset>

      {/* --- Required for every type --- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="isVeg">Vegetarian or non-vegetarian</label>
          <select id="isVeg" name="isVeg" className="field" defaultValue={product?.isVeg === undefined || product?.isVeg === null ? "" : String(product.isVeg)}>
            <option value="">Choose one</option>
            <option value="true">Vegetarian</option>
            <option value="false">Non-vegetarian</option>
          </select>
          <p className="mt-1 text-micro text-ink-faint">
            For gummies this depends on gelatin versus pectin. We won&rsquo;t guess.
          </p>
          {err("isVeg") && <Err>{err("isVeg")}</Err>}
        </div>

        <Field
          label="Total shelf life (days)"
          name="shelfLifeDays"
          type="number"
          defaultValue={product?.shelfLifeDays?.toString()}
          error={err("shelfLifeDays")}
          hint="From manufacture. Sets when stock stops being shippable."
        />
      </div>

      {/* Who it's for. Required for Kids Vault; shown as an age badge. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Suitable from age (years)"
          name="suitableFromAge"
          type="number"
          defaultValue={product?.suitableFromAge?.toString()}
          error={err("suitableFromAge")}
          hint="Required for Kids Vault products."
          optional
        />
        <Field
          label="Suitable up to age (years)"
          name="suitableToAge"
          type="number"
          defaultValue={product?.suitableToAge?.toString()}
          error={err("suitableToAge")}
          optional
        />
      </div>

      <Field
        label="Allergens"
        name="allergens"
        defaultValue={(product?.allergens ?? []).join(", ")}
        hint="Comma separated. Leave blank only if there are genuinely none."
        optional
      />

      {/* --- Food and beverage only --- */}
      {type !== "HEALTH_SUPPLEMENT" && (
        <fieldset className="panel p-4">
          <legend className="label px-1">Nutrition panel</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {NUTRIENTS.map(([key, label, unit]) => (
              <label key={key} className="text-small">
                <span className="mb-1 block font-medium">{label} ({unit})</span>
                <input
                  type="number"
                  step="0.1"
                  className="field tabular"
                  value={nutrition[key] ?? ""}
                  onChange={(e) => setNutrition((n) => ({ ...n, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          {err("nutritionFacts") && <Err>{err("nutritionFacts")}</Err>}
        </fieldset>
      )}

      {/* --- Supplement only --- */}
      {type === "HEALTH_SUPPLEMENT" && (
        <fieldset className="panel p-4">
          <legend className="label px-1">Supplement facts</legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Servings per container" name="servingsPerContainer" type="number" defaultValue={product?.servingsPerContainer?.toString()} error={err("servingsPerContainer")} />
            <Field
              label="Sugar per serving (g)"
              name="sugarPerServingG"
              type="number"
              step="0.1"
              defaultValue={product?.sugarPerServingG?.toString()}
              error={err("sugarPerServingG")}
              hint="Shown as a number next to the price. Enter 0 if there is none."
            />
          </div>

          <div className="mt-4">
            <label className="label" htmlFor="dosageGuidance">Dosage guidance</label>
            <input
              id="dosageGuidance"
              name="dosageGuidance"
              className="field"
              defaultValue={product?.dosageGuidance}
              placeholder="1 gummy daily. Do not exceed the recommended dose."
            />
            <p className="mt-1 text-micro text-ink-faint">
              Must include a do-not-exceed instruction.
            </p>
            {err("dosageGuidance") && <Err>{err("dosageGuidance")}</Err>}
          </div>

          <div className="mt-5 grid gap-2">
            {facts.map((row: any, i: number) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <input
                  className="field"
                  placeholder="Ingredient"
                  value={row.ingredient}
                  onChange={(e) => setFacts((f: any[]) => f.map((r, j) => (j === i ? { ...r, ingredient: e.target.value } : r)))}
                />
                <input
                  className="field"
                  placeholder="5000 mcg"
                  value={row.amountPerServing}
                  onChange={(e) => setFacts((f: any[]) => f.map((r, j) => (j === i ? { ...r, amountPerServing: e.target.value } : r)))}
                />
                <input
                  className="field tabular"
                  placeholder="% RDA"
                  value={row.percentRDA ?? ""}
                  onChange={(e) => setFacts((f: any[]) => f.map((r, j) => (j === i ? { ...r, percentRDA: e.target.value === "" ? null : Number(e.target.value) } : r)))}
                />
                <button
                  type="button"
                  className="btn btn-outline px-3"
                  onClick={() => setFacts((f: any[]) => f.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-outline justify-self-start"
              onClick={() => setFacts((f: any[]) => [...f, { ingredient: "", amountPerServing: "", percentRDA: null }])}
            >
              Add ingredient
            </button>
            {err("supplementFacts") && <Err>{err("supplementFacts")}</Err>}
          </div>

          <label className="mt-6 flex items-start gap-3 border-t border-[--color-rule] pt-4 text-small">
            <input type="checkbox" name="complianceReviewConfirmed" className="mt-1" defaultChecked={Boolean(product?.complianceReviewedAt)} />
            <span>
              I have checked this description says what the product <em>supports</em>, and does not
              claim to treat, cure, prevent or reverse anything.
              {err("complianceReviewConfirmed") && <Err>{err("complianceReviewConfirmed")}</Err>}
            </span>
          </label>
        </fieldset>
      )}

      {/* --- Label declarations: what the law requires an online listing to show --- */}
      <fieldset className="panel grid gap-4 p-4">
        <legend className="label px-1">Label declarations</legend>
        <p className="text-small text-ink-soft">
          Copy these exactly from the pack. They&apos;re shown on the product page, and a product can&apos;t go live
          without them. A draft can be saved without them.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Manufacturer's name" name="manufacturerName" defaultValue={product?.manufacturerName ?? undefined} error={err("manufacturerName")} />
          <Field label="Country of origin" name="countryOfOrigin" defaultValue={product?.countryOfOrigin ?? undefined} error={err("countryOfOrigin")} />
          <Field label="Net quantity" name="netQuantity" defaultValue={product?.netQuantity ?? undefined} error={err("netQuantity")} hint='As printed, e.g. "150 g" or "60 gummies (120 g)".' />
        </div>
        <TextArea label="Manufacturer's address" name="manufacturerAddress" rows={2} defaultValue={product?.manufacturerAddress} error={err("manufacturerAddress")} />
        <TextArea
          label="Packed or marketed by"
          name="packerDetails"
          rows={2}
          defaultValue={product?.packerDetails}
          error={err("packerDetails")}
          hint="Name and address, only if different from the manufacturer."
          optional
        />
        <TextArea
          label="Ingredients"
          name="ingredients"
          rows={3}
          defaultValue={product?.ingredients}
          error={err("ingredients")}
          hint="In descending order of weight, exactly as on the label."
        />
      </fieldset>

      {/* --- Photographs --- */}
      <fieldset className="panel p-4">
        <legend className="label px-1">Photographs</legend>
        <ImageUpload productId={product?.id} images={product?.images} />
      </fieldset>

      {/* --- Retail --- */}
      <div className="grid gap-2">
        <label className="flex items-center gap-3 text-small">
          <input type="checkbox" name="availableInRetail" defaultChecked={product?.availableInRetail} />
          <span>Also sold in our superstores</span>
        </label>
        <label className="flex items-center gap-3 text-small">
          <input type="checkbox" name="retailOnly" defaultChecked={product?.retailOnly} />
          <span>In stores only — never shipped</span>
        </label>
        {err("availableInRetail") && <Err>{err("availableInRetail")}</Err>}
      </div>

      {/* --- Visibility: every product, so any of them can be taken off sale (e.g. a recall) --- */}
      <label className="panel flex items-start gap-3 p-4 text-small">
        <input type="checkbox" name="isActive" className="mt-1" defaultChecked={product?.isActive ?? false} />
        <span>
          <span className="font-semibold">Live on the storefront</span>
          <span className="block text-ink-soft">
            Untick to take it off sale at once: it disappears from the shop, and shoppers who already have it in
            their basket can&apos;t check it out.
            {type === "HEALTH_SUPPLEMENT" && " Supplements also need the claims review above."}
          </span>
          {err("isActive") && <Err>{err("isActive")}</Err>}
        </span>
      </label>

      <div className="flex items-center gap-4 border-t border-[--color-rule] pt-5">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : product?.id ? "Save changes" : "Create product"}
        </button>
        <div aria-live="polite" role="status">
          {state.message && (
            <p className="text-small" style={{ color: state.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
              {state.message}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}

function TextArea({
  label,
  name,
  rows,
  defaultValue,
  error,
  hint,
  optional,
}: {
  label: string;
  name: string;
  rows: number;
  defaultValue?: string | null;
  error?: string;
  hint?: string;
  optional?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
        {optional && <span className="ml-1 font-normal text-ink-faint">(optional)</span>}
      </label>
      <textarea id={name} name={name} rows={rows} defaultValue={defaultValue ?? undefined} className="field" />
      {hint && <p className="mt-1 text-micro text-ink-faint">{hint}</p>}
      {error && <Err>{error}</Err>}
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  error,
  hint,
  optional,
  readOnly,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  readOnly?: boolean;
  /** e.g. "0.1" for decimal figures; number inputs otherwise reject 1.5. */
  step?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
        {optional && <span className="ml-1 font-normal text-ink-faint">(optional)</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        readOnly={readOnly}
        step={step}
        className={readOnly ? "field cursor-not-allowed bg-shelf text-ink-soft" : "field"}
      />
      {hint && <p className="mt-1 text-micro text-ink-faint">{hint}</p>}
      {error && <Err>{error}</Err>}
    </div>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-small text-alert">{children}</p>;
}
