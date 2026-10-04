/**
 * The picture of a box the shopper built: an open SooulOne carton, drawn in
 * CSS 3D, with their packs standing inside (src/components/box-carton.tsx).
 * Pure numbers only, tested (tests/box-carton.test.ts).
 *
 * The carton is drawn at one size (CARTON) and scaled to each frame. Its
 * outline at that size was measured from rendered pixels, so cartonFit() can
 * fill a frame exactly: no flap clipped, no wasted space on the tight side.
 */

export const CARTON = {
  /** Width, depth and height of the carton body, in px at scale 1. */
  w: 150,
  d: 110,
  h: 72,
  /** Seen from a little above and to the left. */
  tiltX: -34,
  turnY: -28,
  /** Flap angles: 0 stands straight up, negative folds outwards. */
  sideFlap: -128,
  backFlap: -50,
  packHeight: 96,
  perspective: 900,
} as const;

/** The drawn outline at scale 1, around the anchor point (the carton's centre). */
export const OUTLINE = { width: 258, above: 111, below: 81, belowWithShadow: 90, rightOfCentre: 2 } as const;

/** Packs drawn standing up; beyond this the front shows "+N". */
export const MAX_SHOWN = 4;

export interface CartonFit {
  readonly scale: number;
  /** Where the anchor sits, from the frame's top and its horizontal centre. */
  readonly top: number;
  readonly left: number;
}

/** Scale and anchor that fill a width x height frame, `pad` px clear on the tight side, centred. */
export function cartonFit(width: number, height: number, pad: number, shadow = false): CartonFit {
  const below = shadow ? OUTLINE.belowWithShadow : OUTLINE.below;
  const tall = OUTLINE.above + below;
  const scale = Math.max(0, Math.min((width - 2 * pad) / OUTLINE.width, (height - 2 * pad) / tall));
  return { scale, top: (height - tall * scale) / 2 + OUTLINE.above * scale, left: -OUTLINE.rightOfCentre * scale };
}

export interface PackSpot {
  readonly x: number;
  readonly z: number;
  /** Turn about the vertical axis, so the packs fan out. */
  readonly turn: number;
  readonly width: number;
  readonly height: number;
}

/** Where each of `count` packs stands: a gentle fan, the middle one set back when there are three or more. */
export function packSpots(count: number): PackSpot[] {
  const n = Math.max(0, Math.min(MAX_SHOWN, Math.floor(count)));
  if (n === 0) return [];
  const width = Math.min(52, (CARTON.w - 16) / n + 10);
  const step = n > 1 ? (CARTON.w - width - 14) / (n - 1) : 0;
  return Array.from({ length: n }, (_, i) => ({
    x: (i - (n - 1) / 2) * step,
    z: n >= 3 && i === Math.floor(n / 2) ? -(CARTON.d / 2) * 0.25 : (CARTON.d / 2) * 0.05,
    turn: n > 1 ? -9 + (18 * i) / (n - 1) : 0,
    width,
    height: CARTON.packHeight,
  }));
}

/** The packs to draw (one picture per unit, in order) and how many more the front notes as "+N". */
export function cartonContents<T>(items: readonly { picture: T; quantity: number }[]): { shown: T[]; more: number } {
  const units = items.flatMap((i) => Array.from({ length: Math.max(0, i.quantity) }, () => i.picture));
  return { shown: units.slice(0, MAX_SHOWN), more: Math.max(0, units.length - MAX_SHOWN) };
}
