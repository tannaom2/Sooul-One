import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { reportError } from "@/lib/observability";

/**
 * Product image upload.
 *
 * The file is posted to our own route and forwarded to Cloudinary from the
 * server, rather than uploaded directly from the browser with a signed
 * preset. Direct-from-browser is faster and cheaper in bandwidth, but it
 * either exposes an unsigned preset that anyone can post arbitrary files to,
 * or needs a signature endpoint anyway — and at SooulOne's volume the saved
 * bandwidth is not worth an open upload endpoint on a site that takes
 * payments.
 *
 * CLOUDINARY_URL carries the API secret, so it must never be prefixed
 * NEXT_PUBLIC_ and nothing in this file may be imported into a client
 * component. The "server-only" import above turns that mistake into a build
 * error rather than a silent credential leak.
 */

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  if (!process.env.CLOUDINARY_URL) return false;

  // The SDK reads CLOUDINARY_URL from the environment itself; calling config()
  // with no argument picks it up and validates it.
  cloudinary.config({ secure: true });
  configured = true;
  return true;
}

export interface UploadResult {
  ok: boolean;
  url?: string;
  publicId?: string;
  width?: number;
  height?: number;
  message?: string;
}

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 8 * 1024 * 1024;

export async function uploadProductImage(file: File): Promise<UploadResult> {
  if (!ensureConfigured()) {
    return {
      ok: false,
      message:
        "Image hosting isn't configured on this deployment. Set CLOUDINARY_URL in your environment to enable uploads.",
    };
  }

  // Validated here as well as in the route: this function is the boundary that
  // actually talks to Cloudinary, and a second caller added later must not be
  // able to bypass the checks by forgetting to repeat them.
  if (!ALLOWED.includes(file.type)) {
    return { ok: false, message: "Upload a JPEG, PNG, WebP or AVIF image." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: "That image is over 8 MB. Compress it and try again." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: "soulone/products",
            resource_type: "image",
            // Strip EXIF. Phone photos of packaging carry GPS coordinates,
            // and a product page is a poor place to publish the location of
            // your warehouse.
            transformation: [{ quality: "auto", fetch_format: "auto" }],
            invalidate: true,
          },
          (error, uploaded) => {
            if (error || !uploaded) reject(error ?? new Error("no response"));
            else resolve(uploaded as unknown as Record<string, unknown>);
          },
        )
        .end(buffer);
    });

    return {
      ok: true,
      url: String(result.secure_url),
      publicId: String(result.public_id),
      width: Number(result.width),
      height: Number(result.height),
    };
  } catch (error) {
    reportError("cloudinary", error, { op: "upload" });
    return { ok: false, message: "That upload didn't go through. Try again." };
  }
}

export async function deleteProductImage(publicId: string): Promise<boolean> {
  if (!ensureConfigured()) return false;
  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
    return true;
  } catch (error) {
    reportError("cloudinary", error, { op: "delete", publicId });
    return false;
  }
}
