# Brand family, trust and support

Who this is for: whoever runs the store and whoever changes the code behind these features.

This covers the brand domains, the top bar, the batch check, search, Learn, FAQs, the Contact page, careers and enquiries. Everything a shopper reads here is set in the console. No fact is typed twice.

## One rule: facts come from settings

These facts appear in copy as tokens:

| Token | Fact | Filled from |
|---|---|---|
| `{freeDelivery}` | Free-delivery amount (₹799/-) | `DEFAULT_SHIPPING_POLICY`, the same value checkout uses |
| `{deliveryFee}` | Delivery fee below that amount | Same |
| `{area}` | Where we deliver (Gujarat) | `SERVICE_AREA` |

Tokens work in:
- the top bar;
- FAQs;
- site text.

Where they're filled in (`src/lib/site-content.ts`):
- the storefront;
- the Help assistant.

An unknown token can't be saved.

## Brand domains (Settings → Brands)

The rules are in `src/lib/brand-domains.ts`; the proxy applies them. Each brand has a domain and one of three modes:

| Mode | What the domain does |
|---|---|
| Not used | Nothing. The brand lives at `sooulone.in/<brand>`. |
| Send to the main site | 301 redirect to the brand's page. Deep links keep their path. |
| Its own site | The domain's home page is the brand page. Products, basket, checkout and Help run on that domain. `/admin` goes to the main site. |

**Search engines:** while a brand runs as its own site, its brand page and its products name the brand domain as the canonical copy. `sitemap.xml` and `robots.txt` answer per domain. The main site's copies stop competing with it in search.

**Baskets and sign-in:** each domain has its own. Browsers keep cookies per site, so a shopper who moves between domains starts a new basket.

### Switching a domain on

1. **DNS:** point the domain at Render. In Render → the web service → Settings → Custom Domains, add `womanaxis.in` and `www.womanaxis.in`. Wait for the certificate.
2. **For "Its own site" only:**
   - Razorpay: add the domain to the website list (Settings → Website and app details) so payments open on it.
   - Cloudflare Turnstile: add the domain to the widget's hostnames.
   - Resend: no change. Emails still link to the main site.
3. **Console:** Settings → Brands, enter the domain, pick the mode, save. Every server picks it up within a minute.
4. **Check:**
   - `https://womanaxis.in/` shows the brand page.
   - "View source" on a product shows `<link rel="canonical" href="https://womanaxis.in/product/...">`.
   - Search Console: add the domain as a property.

**Switching back:** the redirect mode sends a 301, which browsers remember. Visitors who already got it keep being redirected until their browser cache clears.

## Batch check (/verify)

Code: `src/lib/batch-verify.ts` and `src/app/verify/page.tsx`.

**The form:**
- It's a plain form in the address bar, so a QR code on the pack can link to a result: `https://sooulone.in/verify?batch=B241007`.
- Case, spaces and punctuation are ignored.
- Rate limit: 30 checks per 10 minutes per connection (`batchCheck`).

**What each result says:**
- **Found:** "Batch X is ours", with the product, the made-on date and the best-before date. A match proves the batch is genuine, not the individual pack, so the page says that plainly.
- **Past its date:** says so.
- **Recalled:** says don't consume it, and shows the owner's recall note. Recall a batch from Stock batches.
- **Not found:** never called a fake. The shopper gets tips on look-alike characters and a contact link.

**Tracking:**
- Every check is counted (the cleaned-up code and whether it was found).
- Stock batches shows how many times each batch was checked.
- Analytics → Search and batches lists codes that keep failing.

**Only recorded batches can match.** Every delivery must be received under Stock batches, or its packs won't verify.

## Search (/search)

Code: `src/lib/search.ts`.

**Ranking:**
- Scoring is in memory, over the cached catalogue.
- Every word must match. If nothing does, the page shows close matches.
- One typo is forgiven on longer words.

**What's shown:**
- Products, grouped by brand. The brand you came from comes first (the header form sends `from`).
- Then matching FAQs and articles.

**Logging:**
- Each query is logged with digit runs and emails removed.
- Searches that find nothing are listed under Analytics → Search and batches.

## Learn (/learn)

There is one hub for the whole family, with `?brand=` filters. Articles use the small Markdown subset in `src/lib/mini-markdown.ts`. HTML is never rendered.

Articles tagged Woman Axis, Kids Vault or Man Rituals:
- pass the supplement claims check (`src/lib/compliance/claims.ts`): BLOCK findings stop publishing;
- need a person's sign-off, which is cleared whenever the words change;
- carry the supplement statement.

Cover images must be Cloudinary links. The CSP allows images only from there.

## FAQs (/help) and the Help assistant

- The starting FAQs came with the migration.
  - Published: those the store's own systems make true.
  - Drafts: the owner's policies (returns, refunds, damaged or missing parcels, sourcing, suitability). A draft whose answer still starts with "DRAFT:" can't be published.
- The Help assistant answers from published FAQs when its rules don't recognise a question. It only answers on a confident match (`matchFaq`).
- It sends "is this genuine" questions to /verify.
- Google no longer shows FAQ rich results for shops (since 2023), so /help carries no FAQ structured data.

## Contact, careers, enquiries

**/contact:**
- Customer care, hours and the response-time line (Site text).
- The grievance officer, and company details (Business details: CIN and mailing address are new).
- Collaborate and International blocks, which open the form with the topic preselected.
- A Careers block, shown only while a role is published (Settings → Careers).

**The form:**
- It has a hidden field that only scripts fill in, Turnstile (action `enquiry`), and a limit of 5 messages per hour per connection.
- Messages go to Engage → Enquiries (owner and manager: `enquiries:manage`).
- They are emailed to `OWNER_ALERT_EMAIL`, or failing that the customer care address.
- They are deleted after 365 days.

## Console map

| Page | Permission |
|---|---|
| Storefront → Brands, Top bar, Site text | `settings:manage` (owner) |
| Storefront → FAQs, Articles, Careers | `content:write` (owner, manager, content) |
| Engage → Enquiries | `enquiries:manage` (owner, manager) |
| Analytics → Search and batches | `content:write` |
| Business details → CIN, mailing address, SooulOne social links | `settings:manage` |
