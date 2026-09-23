import { describe, expect, it } from "vitest";
import { computeOrderAnalytics, type OrderLike } from "../src/lib/order-analytics-compute";

const order = (over: Partial<OrderLike> = {}): OrderLike => ({
  guestEmail: "shopper@example.com",
  placedAt: new Date("2026-09-01T00:00:00Z"),
  totalAmountPaise: 50000,
  state: "Maharashtra",
  items: [],
  ...over,
});

describe("computeOrderAnalytics", () => {
  it("computes revenue and average order value", () => {
    const result = computeOrderAnalytics(
      [order({ totalAmountPaise: 40000 }), order({ totalAmountPaise: 60000 })],
      new Map(),
      new Map(),
    );
    expect(result.orderCount).toBe(2);
    expect(result.revenuePaise).toBe(100000);
    expect(result.averageOrderValuePaise).toBe(50000);
  });

  it("returns zero AOV without dividing by zero when there are no orders", () => {
    const result = computeOrderAnalytics([], new Map(), new Map());
    expect(result.orderCount).toBe(0);
    expect(result.averageOrderValuePaise).toBe(0);
  });

  it("classifies an order as new when it is the customer's first ever order", () => {
    const placedAt = new Date("2026-09-01T00:00:00Z");
    const firstOrderByEmail = new Map([["a@example.com", placedAt]]);
    const result = computeOrderAnalytics(
      [order({ guestEmail: "a@example.com", placedAt })],
      firstOrderByEmail,
      new Map(),
    );
    expect(result.newCustomerOrders).toBe(1);
    expect(result.repeatCustomerOrders).toBe(0);
  });

  it("classifies an order as repeat when the customer's first order was earlier", () => {
    const firstOrderByEmail = new Map([["a@example.com", new Date("2026-08-01T00:00:00Z")]]);
    const result = computeOrderAnalytics(
      [order({ guestEmail: "a@example.com", placedAt: new Date("2026-09-01T00:00:00Z") })],
      firstOrderByEmail,
      new Map(),
    );
    expect(result.newCustomerOrders).toBe(0);
    expect(result.repeatCustomerOrders).toBe(1);
  });

  it("counts distinct customers by email, not by order", () => {
    const result = computeOrderAnalytics(
      [order({ guestEmail: "a@example.com" }), order({ guestEmail: "a@example.com" }), order({ guestEmail: "b@example.com" })],
      new Map(),
      new Map(),
    );
    expect(result.distinctCustomers).toBe(2);
  });

  it("ranks best-selling products by revenue, aggregating across orders", () => {
    const result = computeOrderAnalytics(
      [
        order({ items: [{ productId: "p1", productNameSnapshot: "Namkeen", quantity: 2, lineTotalPaise: 20000 }] }),
        order({ items: [{ productId: "p1", productNameSnapshot: "Namkeen", quantity: 1, lineTotalPaise: 10000 }] }),
        order({ items: [{ productId: "p2", productNameSnapshot: "Gummies", quantity: 1, lineTotalPaise: 5000 }] }),
      ],
      new Map(),
      new Map(),
    );
    expect(result.topProducts[0]).toMatchObject({ productId: "p1", quantity: 3, revenuePaise: 30000 });
    expect(result.topProducts[1]).toMatchObject({ productId: "p2", revenuePaise: 5000 });
  });

  it("rolls product revenue up to brands via the lookup", () => {
    const result = computeOrderAnalytics(
      [
        order({ items: [{ productId: "p1", productNameSnapshot: "A", quantity: 1, lineTotalPaise: 10000 }] }),
        order({ items: [{ productId: "p2", productNameSnapshot: "B", quantity: 1, lineTotalPaise: 5000 }] }),
      ],
      new Map(),
      new Map([
        ["p1", { brandId: "brand1", name: "Woman Axis" }],
        ["p2", { brandId: "brand1", name: "Woman Axis" }],
      ]),
    );
    expect(result.topBrands).toEqual([{ brandId: "brand1", name: "Woman Axis", revenuePaise: 15000 }]);
  });

  it("groups revenue by state, falling back to Unknown when missing", () => {
    const result = computeOrderAnalytics(
      [order({ state: "Maharashtra", totalAmountPaise: 10000 }), order({ state: null, totalAmountPaise: 5000 })],
      new Map(),
      new Map(),
    );
    const byState = Object.fromEntries(result.revenueByState.map((r) => [r.state, r.revenuePaise]));
    expect(byState.Maharashtra).toBe(10000);
    expect(byState.Unknown).toBe(5000);
  });
});
