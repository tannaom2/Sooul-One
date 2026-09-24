/**
 * Storefront performance budget.
 *
 * Loads the key customer pages on a phone-sized viewport against a PRODUCTION
 * build (development bundles are several times larger and meaningless here),
 * and fails if any page's JavaScript or total transfer exceeds its budget.
 *
 *   npm run build && npx next start -p 3100    # in one terminal
 *   npm run perf:budget                        # in another
 *
 * Budgets are set just above what the pages weigh today, so a change that
 * adds weight has to be a conscious decision. Raise one deliberately, with a
 * reason in the commit, never to make the check pass.
 */
import { chromium } from "playwright";

const BASE = process.env.PERF_BASE_URL ?? "http://localhost:3100";

// KB transferred (compressed) on a cold cache. Measured 2026-09-25 on a
// production build: JS 144 KB on every page (almost all of it the React and
// Next.js runtime shared by every route), 145 on the product page, 150 on the
// basket. Budgets sit about 10% above that. Set every jsKB to 0 to re-measure.
const BUDGETS: { path: string; jsKB: number; totalKB: number }[] = [
  { path: "/", jsKB: 160, totalKB: 180 },
  { path: "/true-store", jsKB: 160, totalKB: 180 },
  { path: "/gummies", jsKB: 160, totalKB: 180 },
  { path: "/product/tesing", jsKB: 160, totalKB: 180 },
  { path: "/cart", jsKB: 165, totalKB: 195 },
  // Checkout carries its own form logic and validation (zod/mini): 169 KB
  // measured after moving off full zod, which had it at 242 KB. Its total
  // (~207 KB) includes ~13 KB of Next prefetching the footer policy links,
  // which happens because the short page shows the footer; not load-blocking.
  { path: "/checkout", jsKB: 185, totalKB: 225 },
];

const MEASURE_ONLY = BUDGETS.every((b) => b.jsKB === 0);

const browser = await chromium.launch();
let failed = false;

for (const budget of BUDGETS) {
  // A fresh context per page: a cold cache, i.e. a first-time shopper landing
  // straight on this page. A shared context would count shared code only once.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
  });
  // tsx (esbuild) wraps named functions in a __name() helper, which doesn't
  // exist inside the page that page.evaluate() runs in.
  await context.addInitScript({ content: "window.__name = (f) => f;" });
  const page = await context.newPage();
  const response = await page.goto(`${BASE}${budget.path}`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const kb = (n: number) => Math.round((n / 1024) * 10) / 10;
    const js = res.filter((r) => r.initiatorType === "script" || r.name.endsWith(".js"));
    const po = new PerformanceObserver(() => {});
    let lcp: number | null = null;
    try {
      po.observe({ type: "largest-contentful-paint", buffered: true });
      const recs = po.takeRecords();
      if (recs.length) lcp = Math.round(recs[recs.length - 1].startTime);
    } catch {}
    return {
      jsKB: kb(js.reduce((a, r) => a + r.transferSize, 0)),
      totalKB: kb(res.reduce((a, r) => a + r.transferSize, 0) + (nav?.transferSize ?? 0)),
      scripts: js.length,
      lcpMs: lcp,
    };
  });
  const over = !MEASURE_ONLY && (m.jsKB > budget.jsKB || m.totalKB > budget.totalKB);
  failed ||= over || !response?.ok();
  console.log(
    `${over ? "OVER" : "ok  "} ${budget.path.padEnd(18)} status ${response?.status()}  JS ${m.jsKB} KB` +
      `${MEASURE_ONLY ? "" : ` / ${budget.jsKB}`}  total ${m.totalKB} KB${MEASURE_ONLY ? "" : ` / ${budget.totalKB}`}` +
      `  scripts ${m.scripts}  LCP ${m.lcpMs ?? "?"} ms`,
  );
  await context.close();
}

await browser.close();
if (MEASURE_ONLY) console.log("\nMeasure-only run: set the budgets in scripts/perf-budget.mts from these figures.");
process.exit(failed ? 1 : 0);
