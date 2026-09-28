# Day and Night mode

How the storefront and owner console handle light and dark. The rules are in `src/lib/theme.ts`, the colours in `src/app/globals.css`, and the checks in `tests/theme.test.ts` and `tests/theme-contrast.test.ts`.

## Who decides the theme

| Where | Switch | Until someone chooses | Saved in |
|---|---|---|---|
| Storefront, owner allows the switch (default) | Sun/moon in the header | The device setting (`prefers-color-scheme`) | `localStorage["soulone-theme"]` |
| Storefront, owner hides the switch | None | The owner's choice for everyone | Admin → Store controls |
| Owner console | Sun/moon in the sidebar footer | The device setting | `localStorage["soulone-console-theme"]` |

The owner sets the storefront behaviour in **Admin → Store controls → Storefront look**: "Allow customers to switch Day/Night mode on Storefront", and "Default Storefront Theme when toggle is hidden". The settings are `StoreSettings.themeToggleVisible` and `StoreSettings.forcedTheme`, cached and cleared on save. Shoppers see a change on their next page load.

**No flash of the wrong colours.** A forced theme is written into the HTML by the server. A shopper's choice is applied by a tiny inline script in `<head>`, which runs before anything is drawn. It carries the page's CSP nonce, and it inlines `resolveTheme` itself, so the script and the tested rule can't drift apart.

**Print is always Day.** Night mode only applies on screen, so invoices and labels print on white.

## Tokens

Components use semantic tokens, never raw colours. Tailwind's utilities are aliases of them. The older names are kept because they're used in hundreds of places:

| Semantic token | Tailwind utility | Day | Night |
|---|---|---|---|
| `--bg-base` | `bg-paper` | `#ffffff` | `#16110d` |
| `--bg-surface` (cards, panels) | `bg-surface` | `#ffffff` | `#1e1813` |
| `--bg-muted` (kraft bands) | `bg-shelf` | `#f2ede4` | `#1b1511` |
| `--bg-elevated` (drawer, menus, box tray) | `bg-elevated` | `#ffffff` + shadow | `#2d241d` |
| `--bg-overlay` (scrim) | `bg-overlay` | brown at 45% | near-black at 66% |
| `--bg-inverse` (top strip) | `bg-inverse` | `#241c15` | `#2d241d` |
| `--text-primary` | `text-ink` | `#241c15` | `#ece3d7` |
| `--text-secondary` | `text-ink-soft` | `#5b4f45` | `#c4b7a8` |
| `--text-muted` | `text-ink-faint` | `#72665a` | `#a09385` |
| `--text-on-primary` / `-on-accent` / `-on-inverse` | `text-on-primary` … | white | dark or off-white |
| `--border-subtle` | `border-rule` | `#ddd3c5` | `#3a3029` |
| `--border-strong` | `border-strong` | `#241c15` | `#a89a8b` |
| `--border-input` (form fields) | — | `#8c7f73` | `#7d7064` |
| `--primary` / `--primary-hover` (CTA) | `bg-primary` | `#241c15` / `#3a2e24` | `#ddd1c2` / `#e9dfd3` |
| `--accent` (turmeric fill) | `bg-accent` | `#e8a317` | `#e0aa45` |
| `--brand-truestore-text` | `text-truestore-text` | `#8a5e00` | `#e9b75a` |

The brand colours (`--brand-womanaxis`, `--brand-kidsvault` and `--brand-manrituals`), the veg and non-veg marks, and the feedback colours (`--feedback-alert` and `--feedback-caution`) each have Day and Night values as well. Use `BRAND_ACCENT` in `src/components/ui.tsx`: it gives the text-safe shade.

## Rules the palette follows

- **WCAG 2.1 AA, enforced by a test.** Every text colour must reach 4.5:1 on every surface. Form-field edges and the primary button must reach 3:1 against the page. `tests/theme-contrast.test.ts` reads the values from `globals.css`, so a palette change that breaks contrast fails the build.
- **Turmeric has two shades.** Bright turmeric is for fills and marks. As text it reaches only about 2.2:1 on white, so text uses `--brand-truestore-text`.
- **Night mode:**
  - It follows Material Design's dark-theme guidance, in the brand's own warmth. The base is a roasted-brown charcoal, not slate or pure black.
  - Text is a warm off-white, not `#ffffff`, which cuts glare (halation).
  - Depth comes from lighter surfaces (base → surface → elevated), not shadows.
  - The primary button is a muted cream, darker than the text.
  - Accents are softened.
  - Images are dimmed to 90% brightness.
- **Day mode:** white and kraft surfaces. Drawers, menus and the box tray lift with soft shadows (`shadow-elevated`). Product cards gain a light shadow on hover (`shadow-card`).

## Adding UI

- Use the semantic utilities: `bg-surface` for a card, `bg-elevated` + `shadow-elevated` for anything that floats, `text-on-primary` on a `bg-primary` fill, and `border-strong` for a heavy rule.
- Don't write hex colours or `white`/`black`. Colour-mixes should mix with `var(--color-paper)`, not `white`.
- A new colour pair that carries text belongs in `tests/theme-contrast.test.ts`.
