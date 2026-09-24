/**
 * Launch readiness: everything that has to be true before the live site takes
 * orders, as one checklist. Blocking items keep checkout closed on the public
 * site (see ordersOpen in src/server/launch-readiness.ts); warnings don't.
 * Pure: the facts are gathered server-side and judged here, so it's tested
 * directly.
 */

export interface ReadinessFacts {
  readonly business: {
    readonly legalName: string | null;
    readonly registeredAddress: string | null;
    readonly gstin: string | null;
    readonly fssaiLicence: string | null;
    readonly customerCarePhone: string | null;
    readonly customerCareEmail: string | null;
    readonly grievanceOfficerName: string | null;
    readonly grievanceOfficerEmail: string | null;
    readonly grievanceOfficerPhone: string | null;
  };
  readonly draftPolicies: readonly string[];
  readonly liveProducts: number;
  /** Live products missing any label declaration, by name. */
  readonly liveProductsMissingDeclarations: readonly string[];
  readonly liveProductsWithoutPhotos: readonly string[];
  readonly emailConfigured: boolean;
  readonly cronConfigured: boolean;
  readonly onlinePayments: boolean;
  readonly errorMonitoring: boolean;
  /** Region of the database host, when it can be read from DATABASE_URL. */
  readonly databaseRegion: string | null;
  /** Active admin accounts that look like test accounts. */
  readonly testAdmins: readonly string[];
  readonly activeOwners: number;
}

export type ItemStatus = "done" | "missing" | "warning" | "manual";

export interface ReadinessItem {
  readonly id: string;
  readonly group: "Business and legal" | "Catalogue" | "Operations" | "Security" | "Confirm yourself";
  readonly label: string;
  readonly status: ItemStatus;
  /** What's wrong, or what to check. */
  readonly detail?: string;
  /** Keeps checkout closed on the live site while not done. */
  readonly blocking: boolean;
  readonly href?: string;
}

export interface Readiness {
  readonly items: readonly ReadinessItem[];
  /** Blocking items not yet done. */
  readonly blockers: readonly ReadinessItem[];
}

const listed = (names: readonly string[], max = 5) =>
  names.slice(0, max).join(", ") + (names.length > max ? ` and ${names.length - max} more` : "");

/** Database regions this far from Gujarat add a long round trip to every query. */
const FAR_REGIONS = /^(us|eu|ca|sa|af|me)-/;

export function evaluateReadiness(f: ReadinessFacts): Readiness {
  const b = f.business;
  const need = (value: string | null) => (value ? "done" : "missing");
  const items: ReadinessItem[] = [
    // --- Business and legal: shown on the site and printed on invoices ---
    { id: "legal-name", group: "Business and legal", label: "Registered company name", status: need(b.legalName), blocking: true, href: "/admin/business" },
    { id: "address", group: "Business and legal", label: "Registered address", status: need(b.registeredAddress), blocking: true, href: "/admin/business" },
    { id: "gstin", group: "Business and legal", label: "GSTIN", detail: b.gstin ? undefined : "Every tax invoice needs it.", status: need(b.gstin), blocking: true, href: "/admin/business" },
    { id: "fssai", group: "Business and legal", label: "FSSAI licence number", status: need(b.fssaiLicence), blocking: true, href: "/admin/business" },
    {
      id: "customer-care",
      group: "Business and legal",
      label: "Customer care phone or email",
      status: b.customerCarePhone || b.customerCareEmail ? "done" : "missing",
      blocking: true,
      href: "/admin/business",
    },
    {
      id: "grievance",
      group: "Business and legal",
      label: "Grievance officer",
      detail: "Name plus a phone or email, required on the site by the E-Commerce Rules.",
      status: b.grievanceOfficerName && (b.grievanceOfficerEmail || b.grievanceOfficerPhone) ? "done" : "missing",
      blocking: true,
      href: "/admin/business",
    },
    {
      id: "policies",
      group: "Business and legal",
      label: "Policy pages written",
      detail: f.draftPolicies.length ? `Still drafts: ${f.draftPolicies.join(", ")}.` : undefined,
      status: f.draftPolicies.length ? "missing" : "done",
      blocking: true,
      href: "/policies/refunds",
    },

    // --- Catalogue ---
    { id: "live-products", group: "Catalogue", label: "At least one product on sale", status: f.liveProducts > 0 ? "done" : "missing", blocking: true, href: "/admin/products" },
    {
      id: "declarations",
      group: "Catalogue",
      label: "Every live product has its full label declarations",
      detail: f.liveProductsMissingDeclarations.length ? `Missing on: ${listed(f.liveProductsMissingDeclarations)}.` : undefined,
      status: f.liveProductsMissingDeclarations.length ? "missing" : "done",
      blocking: true,
      href: "/admin/products",
    },
    {
      id: "photos",
      group: "Catalogue",
      label: "Every live product has a photo",
      detail: f.liveProductsWithoutPhotos.length ? `No photo: ${listed(f.liveProductsWithoutPhotos)}.` : undefined,
      status: f.liveProductsWithoutPhotos.length ? "warning" : "done",
      blocking: false,
      href: "/admin/products",
    },

    // --- Operations ---
    {
      id: "email",
      group: "Operations",
      label: "Email sending set up",
      detail: f.emailConfigured ? undefined : "Without it customers get no confirmation, and the email is their only link back to their order.",
      status: f.emailConfigured ? "done" : "missing",
      blocking: true,
    },
    {
      id: "cron",
      group: "Operations",
      label: "Scheduled jobs set up (CRON_SECRET)",
      detail: f.cronConfigured ? undefined : "Closes unpaid orders and sends the near-expiry stock alert.",
      status: f.cronConfigured ? "done" : "warning",
      blocking: false,
    },
    {
      id: "payments",
      group: "Operations",
      label: "Online payment (Razorpay)",
      detail: f.onlinePayments ? undefined : "Checkout offers cash on delivery only until it's set up.",
      status: f.onlinePayments ? "done" : "warning",
      blocking: false,
    },
    {
      id: "monitoring",
      group: "Operations",
      label: "Error monitoring (Sentry)",
      detail: f.errorMonitoring ? undefined : "Errors only reach the server log, where nobody is watching.",
      status: f.errorMonitoring ? "done" : "warning",
      blocking: false,
    },
    {
      id: "db-region",
      group: "Operations",
      label: "Database close to customers",
      detail:
        f.databaseRegion && FAR_REGIONS.test(f.databaseRegion)
          ? `The database is in ${f.databaseRegion}, so every query crosses an ocean. Move it to Singapore (ap-southeast-1).`
          : undefined,
      status: f.databaseRegion && FAR_REGIONS.test(f.databaseRegion) ? "warning" : "done",
      blocking: false,
    },

    // --- Security ---
    {
      id: "test-admins",
      group: "Security",
      label: "Test admin accounts deactivated",
      detail: f.testAdmins.length ? `Still active: ${listed(f.testAdmins)}.` : undefined,
      status: f.testAdmins.length ? "missing" : "done",
      blocking: true,
      href: "/admin/team",
    },
    {
      id: "second-owner",
      group: "Security",
      label: "A second owner account",
      detail: f.activeOwners < 2 ? "If the only owner loses their phone, nobody can reset them from the Team page." : undefined,
      status: f.activeOwners >= 2 ? "done" : "warning",
      blocking: false,
      href: "/admin/team",
    },

    // --- Things the app can't see for itself ---
    { id: "repo-private", group: "Confirm yourself", label: "Code repository made private on GitHub, and the free code scanner swapped in", status: "manual", blocking: false },
    { id: "accountant", group: "Confirm yourself", label: "Accountant has checked the invoice layout and how delivery is taxed", status: "manual", blocking: false },
    { id: "test-orders", group: "Confirm yourself", label: "Test orders removed from the live database", status: "manual", blocking: false },
  ];
  return { items, blockers: items.filter((i) => i.blocking && i.status !== "done") };
}

/**
 * Whether the launch gate applies: only on the public site (an https
 * SITE_URL that isn't localhost), so development, CI and local load tests
 * keep working. LAUNCH_GATE=off is the owner's emergency override.
 */
export function gateEnforced(siteUrl: string | undefined, override: string | undefined): boolean {
  if (override === "off") return false;
  if (!siteUrl) return false;
  try {
    const url = new URL(siteUrl);
    return url.protocol === "https:" && !["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** "us-east-2" from a Neon or AWS-style host such as ep-x-pooler.c-6.us-east-2.aws.neon.tech. */
export function regionFromDatabaseUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.match(/\b([a-z]{2}-[a-z]+-\d)\b/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Accounts that look like they exist for testing, not for a real person. */
export function looksLikeTestAccount(email: string): boolean {
  return /@(.+\.)?(test|example|localhost)$|@example\.(com|in|org)$/i.test(email);
}
