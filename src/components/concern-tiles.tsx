import Link from "next/link";
import { concernDisplay, type ConcernIcon } from "@/lib/concern-display";

export interface ConcernTile {
  readonly slug: string;
  readonly name: string;
  readonly products: readonly { slug: string; name: string }[];
}

/**
 * "Shop by concern" as need tiles, the way supplement brands present it: every
 * concern visible at once (no row to scroll), in the shopper's words with an
 * icon, and no counts.
 *
 * A concern with one product names it and goes straight to it; filtering down
 * to a single card would be a wasted step. A concern with several filters the
 * list below, as a plain link (a shareable URL), replacing history so Back
 * leaves the page. The grid shrinks to fit how many concerns a brand has.
 */
export function ConcernTiles({
  basePath,
  tiles,
  active,
  accent,
}: {
  basePath: string;
  tiles: readonly ConcernTile[];
  active: string | null;
  accent: string;
}) {
  if (tiles.length < 2) return null;

  return (
    <nav aria-labelledby="concern-h" className="border-b border-rule">
      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="concern-h" className="text-micro font-semibold tracking-wide text-ink-faint uppercase">
            Shop by concern
          </h2>
          {active && (
            <Link href={basePath} replace scroll={false} className="text-small underline">
              Show all
            </Link>
          )}
        </div>
        <ul className={`grid gap-2 sm:gap-3 ${gridFor(tiles.length)}`}>
          {tiles.map((tile) => {
            const { label, icon } = concernDisplay(tile.name);
            const single = tile.products.length === 1 ? tile.products[0] : null;
            const isActive = tile.slug === active;
            const detail = single
              ? single.name
              : tile.products
                  .slice(0, 2)
                  .map((p) => p.name)
                  .join(", ") + (tile.products.length > 2 ? " and more" : "");
            return (
              <li key={tile.slug}>
                <Link
                  href={single ? `/product/${single.slug}` : `${basePath}?concern=${tile.slug}`}
                  // Filtering refines this page rather than opening a new one, so it replaces history.
                  replace={!single}
                  scroll={single ? undefined : false}
                  aria-current={isActive ? "page" : undefined}
                  className="flex h-full items-center gap-3 border bg-surface p-3 transition-colors hover:border-strong"
                  style={{ borderRadius: "var(--radius-panel)", borderColor: isActive ? accent : "var(--color-rule)" }}
                >
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                    style={{ color: accent, background: `color-mix(in srgb, ${accent} 12%, transparent)` }}
                    aria-hidden
                  >
                    <Icon name={icon} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-small leading-snug font-semibold">{label}</span>
                    <span className="block truncate text-micro text-ink-faint">{detail}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/** Two across on a phone; wider screens fit the count, so 3, 5 or 8 tiles all sit evenly. */
function gridFor(count: number): string {
  if (count <= 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-2 sm:grid-cols-3";
  if (count === 4) return "grid-cols-2 lg:grid-cols-4";
  if (count === 5) return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";
  if (count === 6) return "grid-cols-2 sm:grid-cols-3";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";
}

const PATHS: Record<ConcernIcon, React.ReactNode> = {
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  leaf: (
    <>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z" />
      <path d="M2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
      <path d="M19 15v4M17 17h4" />
    </>
  ),
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />,
  gut: (
    <>
      <path d="M3 9c2.5 0 2.5 3 5 3s2.5-3 5-3 2.5 3 5 3 2-1.5 3-3" />
      <path d="M3 15c2.5 0 2.5 3 5 3s2.5-3 5-3 2.5 3 5 3 2-1.5 3-3" />
    </>
  ),
  flower: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="12" cy="6" r="3" />
      <circle cx="18" cy="12" r="3" />
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="12" r="3" />
    </>
  ),
  scale: <path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7ZM19 7l-3 7a3 3 0 0 0 6 0l-3-7ZM8 21h8" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  bulb: <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z" />,
  bone: (
    <path d="M17 10c.7-.7 1.7-.9 2.6-.5a2.5 2.5 0 1 0-1.1-4.6 2.5 2.5 0 1 0-4.6-1.1c.4.9.2 1.9-.5 2.6l-6.8 6.8c-.7.7-1.7.9-2.6.5a2.5 2.5 0 1 0 1.1 4.6 2.5 2.5 0 1 0 4.6 1.1c-.4-.9-.2-1.9.5-2.6Z" />
  ),
  flame: <path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7Z" />,
  dot: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
};

function Icon({ name }: { name: ConcernIcon }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
