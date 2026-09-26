"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Existing {
  id: string;
  url: string;
  altText: string;
  isPrimary: boolean;
}

/**
 * Product photographs.
 *
 * Only shown once a product exists, because an image row needs a productId to
 * attach to. Creating the product first and adding photos second is one extra
 * step, but it avoids orphaned uploads sitting in Cloudinary whenever someone
 * abandons a half-filled form.
 */
export function ImageUpload({ productId, images }: { productId?: string; images?: Existing[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!productId) {
    return (
      <p className="text-small text-ink-faint">
        Save this product first, then come back to add photographs.
      </p>
    );
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);

    const body = new FormData();
    body.append("file", file);
    body.append("productId", productId!);
    body.append("altText", file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));

    try {
      const response = await fetch("/api/admin/upload", { method: "POST", body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.message ?? "That upload didn't go through.");
        return;
      }
      router.refresh();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      {images && images.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((img) => (
            <li key={img.id} className="relative">
              {/* Plain <img> on purpose: these are 72px admin thumbnails on a
                  page only the owner sees, so next/image's on-demand optimiser
                  costs more than it saves. The storefront card uses next/image,
                  where LCP actually matters. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.altText}
                width={72}
                height={72}
                style={{ width: 72, height: 72, objectFit: "cover" }}
                className="border border-rule"
              />
              {img.isPrimary && (
                <span className="absolute bottom-0 left-0 bg-ink px-1 text-micro text-paper">
                  main
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <label className="text-small">
        <span className="mb-1 block font-medium">Add a photograph</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
          className="field"
        />
      </label>

      {busy && <p className="text-small text-ink-soft">Uploading…</p>}
      {error && <p className="text-small text-alert">{error}</p>}
    </div>
  );
}
