import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireAdmin } from "@/lib/auth";
import { uploadProductImage } from "@/lib/cloudinary";

export const runtime = "nodejs";

/**
 * Product image upload.
 *
 * Admin-only and re-checks the session itself rather than trusting the proxy
 * gate — an unauthenticated upload endpoint is a free file host attached to
 * someone else's Cloudinary bill.
 */
export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ message: "Sign in again." }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const productId = String(form?.get("productId") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ message: "Choose an image to upload." }, { status: 400 });
  }
  if (!productId) {
    return NextResponse.json({ message: "Save the product before adding images." }, { status: 400 });
  }

  const result = await uploadProductImage(file);
  if (!result.ok) {
    // 503 rather than 400 when the integration simply isn't set up: the
    // request was fine, the deployment isn't, and the two deserve different
    // messages in the admin UI.
    const status = result.message?.includes("isn't configured") ? 503 : 400;
    return NextResponse.json({ message: result.message }, { status });
  }

  const existing = await db.productImage.count({ where: { productId } });

  const image = await db.productImage.create({
    data: {
      productId,
      url: result.url!,
      altText: String(form?.get("altText") ?? "").trim() || "Product photograph",
      sortOrder: existing,
      // First image uploaded becomes the primary one, so a product is never
      // left with images but no thumbnail.
      isPrimary: existing === 0,
    },
  });

  await audit(session.adminUserId, "UPLOAD_IMAGE", "ProductImage", image.id, { productId });

  return NextResponse.json({ ok: true, id: image.id, url: image.url });
}
