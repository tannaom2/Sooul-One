"use client";

import Image from "next/image";
import { useRef, useState } from "react";

/**
 * Product photos. On phones a swipeable strip (native scroll-snap, no gesture
 * library); on larger screens thumbnails pick the photo. The first photo is
 * the page's largest element, so it loads with priority.
 */
export function ProductGallery({
  images,
  name,
  accent,
  fallbackLabel,
}: {
  images: { url: string; altText: string }[];
  name: string;
  accent: string;
  /** Shown on the tinted placeholder when there are no photos yet. */
  fallbackLabel: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div
        className="flex aspect-square w-full items-end p-5 sm:aspect-[4/3]"
        style={{ background: `color-mix(in srgb, ${accent} 12%, white)`, borderRadius: "var(--radius-panel)" }}
      >
        <span className="text-small font-semibold" style={{ color: accent }}>
          {fallbackLabel}
        </span>
      </div>
    );
  }

  function show(index: number) {
    setActive(index);
    const el = strip.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }

  return (
    <div className="grid gap-3">
      <div
        ref={strip}
        className="flex snap-x snap-mandatory overflow-x-auto"
        style={{ scrollbarWidth: "none", borderRadius: "var(--radius-panel)" }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        aria-label={`Photos of ${name}`}
      >
        {images.map((img, i) => (
          <div key={img.url} className="w-full shrink-0 snap-start">
            <Image
              src={img.url}
              alt={img.altText || (i === 0 ? name : "")}
              width={900}
              height={900}
              priority={i === 0}
              sizes="(min-width: 1024px) 600px, 100vw"
              className="aspect-square w-full border border-rule bg-shelf object-contain"
            />
          </div>
        ))}
      </div>

      {images.length > 1 && (
        <div className="flex gap-2" role="group" aria-label="Choose a photo">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => show(i)}
              aria-label={`Photo ${i + 1} of ${images.length}`}
              aria-current={i === active}
              className={`h-14 w-14 overflow-hidden border ${i === active ? "border-ink" : "border-rule"}`}
              style={{ borderRadius: "var(--radius-panel)" }}
            >
              <Image src={img.url} alt="" width={56} height={56} sizes="56px" loading="eager" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
