import { describe, expect, it } from "vitest";
import { SETTINGS, WORKSPACES, locate, visibleWorkspaces } from "@/lib/console-nav";
import { pickList, slipLines } from "@/lib/packing";

/** The console's shell (src/lib/console-nav.ts) and the packing screen's sums (src/lib/packing.ts). */

/** Every page the sidebar linked to before the shell: each must still be one click from its workspace. */
const OLD_LINKS = [
  "/admin", "/admin/orders", "/admin/analytics/risk", "/admin/batches", "/admin/suppliers", "/admin/messages",
  "/admin/products", "/admin/categories", "/admin/bundles", "/admin/boxes", "/admin/analytics/site",
  "/admin/enquiries", "/admin/reviews", "/admin/referrals", "/admin/coupons",
  "/admin/brands", "/admin/top-bar", "/admin/site-text", "/admin/faqs", "/admin/articles", "/admin/careers",
  "/admin/analytics", "/admin/funnel", "/admin/reconciliation", "/admin/activity/downloads",
  "/admin/launch", "/admin/controls", "/admin/assistants", "/admin/business", "/admin/stores", "/admin/team", "/admin/activity",
];

describe("workspaces", () => {
  const tabs = [...WORKSPACES, SETTINGS].flatMap((w) => w.tabs.map((t) => t.href));

  it("keep every page the old sidebar had, at the same address", () => {
    expect(OLD_LINKS.filter((href) => !tabs.includes(href))).toEqual([]);
    expect(OLD_LINKS).toHaveLength(32);
  });

  it("are seven, with Settings apart", () => {
    expect(WORKSPACES.map((w) => w.label)).toEqual(["Today", "Orders", "Stock", "Catalogue", "Customers", "Storefront", "Insights"]);
    expect(new Set(tabs).size).toBe(tabs.length);
  });

  it("show each role only what it can open", () => {
    const labels = (role: Parameters<typeof visibleWorkspaces>[0]) => {
      const v = visibleWorkspaces(role);
      return [...v.workspaces.map((w) => `${w.label}: ${w.tabs.map((t) => t.label).join(", ")}`), v.settings ? `Settings: ${v.settings.tabs.length}` : "no settings"];
    };
    expect(labels("OWNER")).toHaveLength(8);
    expect(labels("FULFILMENT")).toEqual([
      "Today: Today",
      "Orders: Orders, Packing, Returns, RTO risk, Emails",
      "Stock: Batches, Suppliers",
      "Catalogue: Products",
      "no settings",
    ]);
    expect(labels("CONTENT")).toEqual(["Today: Today", "Catalogue: Products, Categories, Search terms", "Customers: Reviews", "Storefront: FAQs, Articles, Careers", "no settings"]);
  });
});

describe("where an address belongs", () => {
  const at = (path: string, search = "") => {
    const l = locate(path, search);
    return l ? `${l.workspace} › ${l.tab}` : null;
  };

  it("finds the workspace and tab, the most specific match winning", () => {
    expect(at("/admin")).toBe("today › /admin");
    expect(at("/admin/orders")).toBe("orders › /admin/orders");
    expect(at("/admin/orders", "view=returned")).toBe("orders › /admin/orders?view=returned");
    expect(at("/admin/orders", "view=shipped")).toBe("orders › /admin/orders");
    expect(at("/admin/orders/ord_123")).toBe("orders › /admin/orders");
    expect(at("/admin/orders/packing")).toBe("orders › /admin/orders/packing");
    expect(at("/admin/orders/packing/print")).toBe("orders › /admin/orders/packing");
    expect(at("/admin/analytics/risk")).toBe("orders › /admin/analytics/risk");
    expect(at("/admin/analytics/site")).toBe("catalogue › /admin/analytics/site");
    expect(at("/admin/analytics/pincodes")).toBe("insights › /admin/analytics");
    expect(at("/admin/batches/bat_1")).toBe("stock › /admin/batches");
    expect(at("/admin/products/prd_1")).toBe("catalogue › /admin/products");
  });

  it("keeps downloads under Insights and the activity log under Settings", () => {
    expect(at("/admin/activity/downloads")).toBe("insights › /admin/activity/downloads");
    expect(at("/admin/activity/export/orders")).toBe("insights › /admin/activity/downloads");
    expect(at("/admin/activity")).toBe("settings › /admin/activity");
    expect(at("/admin/activity/verify")).toBe("settings › /admin/activity");
  });

  it("leaves pages outside the shell alone", () => {
    expect(at("/admin/account")).toBeNull();
    expect(at("/admin/ordersx")).toBeNull();
  });
});

describe("the packing screen", () => {
  const ORDERS = [
    { id: "a", orderNumber: "SO-A", lines: [{ productId: "p1", name: "Ragi Chips", quantity: 2, batchNumber: "B1" }, { productId: "p2", name: "Biotin Gummies", quantity: 1, batchNumber: "G1" }] },
    { id: "b", orderNumber: "SO-B", lines: [{ productId: "p1", name: "Ragi Chips", quantity: 1, batchNumber: "B1" }, { productId: "p1", name: "Ragi Chips", quantity: 1, batchNumber: "B2" }] },
  ];

  it("adds up what to fetch by product and batch, most units first", () => {
    expect(pickList(ORDERS)).toEqual([
      { name: "Ragi Chips", batchNumber: "B1", units: 3, orders: 2 },
      { name: "Biotin Gummies", batchNumber: "G1", units: 1, orders: 1 },
      { name: "Ragi Chips", batchNumber: "B2", units: 1, orders: 1 },
    ]);
    expect(pickList([])).toEqual([]);
  });

  it("puts each product and batch on one slip line", () => {
    const lines = [...ORDERS[1].lines, { productId: "p1", name: "Ragi Chips", quantity: 2, batchNumber: "B1" }];
    expect(slipLines(lines).map((l) => [l.batchNumber, l.quantity])).toEqual([["B1", 3], ["B2", 1]]);
  });
});
