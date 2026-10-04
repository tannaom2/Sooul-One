"use server";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { reportError } from "@/lib/observability";

export interface SearchHit {
  readonly kind: "Order" | "Product" | "Batch" | "Supplier";
  readonly label: string;
  readonly detail: string;
  readonly href: string;
}

/**
 * The console's Ctrl+K search (benchmark gap M13): orders by number, phone or
 * name; products by name; batches by number; suppliers by name. Each kind
 * only for roles that can open it, five of each at most.
 */
export async function consoleSearch(query: string): Promise<SearchHit[]> {
  const session = await requirePermission("dashboard:view");
  if (!session) return [];
  const q = (typeof query === "string" ? query : "").trim().slice(0, 60);
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const role = session.role;
  try {
    const [orders, products, batches, suppliers] = await Promise.all([
      can(role, "orders:view")
        ? db.order.findMany({
            where: {
              OR: [
                { orderNumber: { contains: q, mode: "insensitive" } },
                ...(digits.length >= 4 ? [{ guestPhone: { contains: digits } }] : []),
                { shippingAddress: { path: ["name"], string_contains: q } },
              ],
            },
            orderBy: { placedAt: "desc" },
            take: 5,
            select: { id: true, orderNumber: true, status: true, shippingAddress: true },
          })
        : [],
      can(role, "products:view")
        ? db.product.findMany({ where: { name: { contains: q, mode: "insensitive" } }, orderBy: { name: "asc" }, take: 5, select: { id: true, name: true, isActive: true } })
        : [],
      can(role, "recalls:manage")
        ? db.productBatch.findMany({ where: { batchNumber: { contains: q, mode: "insensitive" } }, orderBy: { expiresOn: "desc" }, take: 5, select: { id: true, batchNumber: true, product: { select: { name: true } } } })
        : [],
      can(role, "batches:write")
        ? db.supplier.findMany({ where: { name: { contains: q, mode: "insensitive" } }, orderBy: { name: "asc" }, take: 5, select: { id: true, name: true } })
        : [],
    ]);
    return [
      ...orders.map((o) => ({
        kind: "Order" as const,
        label: o.orderNumber,
        detail: `${((o.shippingAddress as { name?: string } | null)?.name ?? "").trim()} · ${o.status.replace(/_/g, " ").toLowerCase()}`.replace(/^ · /, ""),
        href: `/admin/orders/${o.id}`,
      })),
      ...products.map((p) => ({ kind: "Product" as const, label: p.name, detail: p.isActive ? "Live" : "Off", href: `/admin/products/${p.id}` })),
      ...batches.map((b) => ({ kind: "Batch" as const, label: b.batchNumber, detail: b.product.name, href: `/admin/batches/${b.id}` })),
      ...suppliers.map((s) => ({ kind: "Supplier" as const, label: s.name, detail: "Supplier", href: `/admin/suppliers#${s.id}` })),
    ];
  } catch (error) {
    reportError("console/search", error);
    return [];
  }
}
