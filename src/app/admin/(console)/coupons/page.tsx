import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { formatINR } from "@/lib/money";
import { decimalToPaise } from "@/lib/format";
import { couponStatus, type CouponStatus } from "@/lib/validation/coupon";
import { CouponForm, CouponToggle } from "./coupon-forms";

export const dynamic = "force-dynamic";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
const STATUS_COLOR: Record<CouponStatus, string> = {
  active: "var(--color-veg)",
  scheduled: "var(--color-ink-soft)",
  expired: "var(--color-ink-faint)",
  "used up": "var(--color-ink-faint)",
  off: "var(--color-alert)",
};

export default async function CouponsPage() {
  const session = await requirePermission("products:pricing");
  if (!session) return <NoAccess />;

  let coupons: Awaited<ReturnType<typeof db.coupon.findMany>> = [];
  try {
    coupons = await db.coupon.findMany({ orderBy: { validUntil: "desc" }, take: 200 });
  } catch (error) {
    reportError("admin/coupons", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Discount codes</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          Codes shoppers type at checkout. A code can&apos;t be edited once created, so every order keeps the terms it
          was given: to change one, switch it off and create a new one. Switching a code off doesn&apos;t touch orders
          that already used it.
        </p>
      </div>

      <CouponForm today={today} />

      {coupons.length === 0 ? (
        <Empty title="No codes yet" detail="Create one above; it works at checkout from its start date." />
      ) : (
        <div className="overflow-x-auto">
          <table className="panel w-full min-w-[720px] border-collapse text-small">
            <thead>
              <tr className="border-b border-rule text-left text-micro uppercase tracking-wide text-ink-faint">
                <th className="p-3">Code</th>
                <th className="p-3">Discount</th>
                <th className="p-3">Minimum order</th>
                <th className="p-3">Used</th>
                <th className="p-3">Valid</th>
                <th className="p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => {
                const status = couponStatus(c, now);
                const value = Number(c.discountValue);
                return (
                  <tr key={c.id} className="border-b border-rule last:border-b-0">
                    <td className="p-3 font-semibold tabular">{c.code}</td>
                    <td className="p-3 tabular">{c.discountType === "PERCENTAGE" ? `${value}% off` : `${formatINR(decimalToPaise(c.discountValue))} off`}</td>
                    <td className="p-3 tabular">{c.minOrderValue ? formatINR(decimalToPaise(c.minOrderValue)) : "—"}</td>
                    <td className="p-3 tabular">
                      {c.usedCount}
                      {c.maxUses !== null && ` of ${c.maxUses}`}
                    </td>
                    <td className="p-3">
                      {day.format(c.validFrom)} – {day.format(c.validUntil)}
                    </td>
                    <td className="p-3 font-semibold" style={{ color: STATUS_COLOR[status] }}>
                      {status}
                    </td>
                    <td className="p-3 text-right">
                      <CouponToggle couponId={c.id} isActive={c.isActive} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
