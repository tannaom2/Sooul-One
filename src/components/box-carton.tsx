import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { CARTON, cartonFit, packSpots } from "@/lib/box-carton";

/**
 * A box the shopper built, pictured as an open SooulOne carton with their
 * packs standing inside, drawn in CSS 3D from the real product photos
 * (geometry and sizing: src/lib/box-carton.ts). One drawing for every size:
 * the basket's 64 px tile, the basket page, saved boxes and the box page,
 * where packs drop in as they're picked (`spots` + `animate`).
 *
 * Decorative: the box's contents are always written beside it, so it's
 * hidden from screen readers. Kraft colours are fixed, like a real carton.
 */

const KRAFT = {
  front: "#c99f62",
  bottom: "#8f6a3a",
  backInside: "linear-gradient(180deg, #b88e55, #a37a44)",
  leftInside: "linear-gradient(180deg, #9c7340, #8a6334)",
  right: "linear-gradient(90deg, #a97f45, #946c38)",
  flap: "linear-gradient(0deg, #b58a50, #d2aa6e)",
};

const { w: W, d: D, h: H } = CARTON;

function Face({ width, height, transform, background, style, children }: { width: number; height: number; transform: string; background: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div style={{ position: "absolute", left: -width / 2, top: -height / 2, width, height, transform, background, ...style }}>
      {children}
    </div>
  );
}

function Flap({ width, height, wall, angle }: { width: number; height: number; wall: string; angle: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: -width / 2,
        top: -H / 2 - height,
        width,
        height,
        transformOrigin: "50% 100%",
        transform: `${wall} rotateX(${angle}deg)`,
        background: KRAFT.flap,
        borderRadius: "2px 2px 0 0",
      }}
    />
  );
}

export interface BoxCartonProps {
  /** Pictures of the packs to stand in the carton, in order (up to four). */
  readonly packs: readonly (string | null)[];
  /** Packs beyond those drawn, noted as "+N" on the front. */
  readonly more?: number;
  /** A full box gets the green COMPLETE band. */
  readonly complete?: boolean;
  readonly width: number;
  readonly height: number;
  /** Clear space on the tighter side of the frame. */
  readonly pad?: number;
  readonly shadow?: boolean;
  /** The box page: this many places, the empty ones waiting above until a pack drops in. */
  readonly spots?: number;
  readonly animate?: boolean;
}

export function BoxCarton({ packs, more = 0, complete = false, width, height, pad = 1, shadow = false, spots, animate = false }: BoxCartonProps) {
  const fit = cartonFit(width, height, pad, shadow);
  // Room for the little pop when the box fills.
  const scale = animate && !complete ? fit.scale * 0.96 : fit.scale;
  const places = packSpots(spots ?? packs.length);
  const motion = animate ? "motion-reduce:transition-none" : "";

  return (
    <div aria-hidden style={{ position: "relative", width, height, overflow: "hidden" }}>
      {shadow && (
        <div
          style={{
            position: "absolute",
            left: `calc(50% + ${fit.left - 105 * fit.scale}px)`,
            top: fit.top + 64 * fit.scale,
            width: 210 * fit.scale,
            height: 26 * fit.scale,
            borderRadius: "50%",
            background: "radial-gradient(closest-side, rgba(40,25,10,.35), rgba(40,25,10,0))",
            filter: `blur(${2 * fit.scale}px)`,
          }}
        />
      )}
      <div
        className={motion}
        style={{
          position: "absolute",
          left: `calc(50% + ${fit.left}px)`,
          top: fit.top,
          transform: `scale(${scale})`,
          transformStyle: "preserve-3d",
          transition: animate ? "transform .45s cubic-bezier(.3,1.9,.5,1)" : undefined,
        }}
      >
        <div style={{ position: "absolute", perspective: CARTON.perspective, transformStyle: "preserve-3d" }}>
          <div style={{ position: "absolute", transformStyle: "preserve-3d", transform: `rotateX(${CARTON.tiltX}deg) rotateY(${CARTON.turnY}deg)` }}>
            {/* Inside first (floor, back and left walls), then the packs, then the outside. */}
            <Face width={W} height={D} transform={`rotateX(-90deg) translateZ(${H / 2}px)`} background={KRAFT.bottom} />
            <Face width={W} height={H} transform={`rotateY(180deg) translateZ(${D / 2}px)`} background={KRAFT.backInside} />
            <Face width={D} height={H} transform={`rotateY(-90deg) translateZ(${W / 2}px)`} background={KRAFT.leftInside} />

            {places.map((spot, i) => {
              const picture = packs[i];
              const filled = picture !== undefined;
              return (
                <div
                  key={i}
                  className={motion}
                  style={{
                    position: "absolute",
                    left: -spot.width / 2,
                    top: H / 2 - spot.height,
                    width: spot.width,
                    height: spot.height,
                    transform: `translate3d(${spot.x}px, ${filled ? 0 : -230}px, ${spot.z}px) rotateY(${spot.turn}deg)`,
                    opacity: filled ? 1 : 0,
                    transition: animate ? "transform .6s cubic-bezier(.2,1.35,.45,1), opacity .2s ease" : undefined,
                  }}
                >
                  {filled &&
                    (picture ? (
                      <Image
                        src={picture}
                        alt=""
                        width={Math.round(spot.width * 2)}
                        height={spot.height * 2}
                        className="block h-full w-full object-cover"
                        style={{ border: "2px solid #fff", borderRadius: 3, boxShadow: "0 2px 6px rgba(0,0,0,.25)" }}
                      />
                    ) : (
                      <span className="block h-full w-full" style={{ background: "#f2ede4", border: "2px solid #fff", borderRadius: 3 }} />
                    ))}
                </div>
              );
            })}

            <Face width={D} height={H} transform={`rotateY(90deg) translateZ(${W / 2}px)`} background={KRAFT.right} />
            <Face
              width={W}
              height={H}
              transform={`translateZ(${D / 2}px)`}
              background={`linear-gradient(180deg, rgba(0,0,0,.10), rgba(0,0,0,0) 30%, rgba(0,0,0,.06)), ${KRAFT.front}`}
              style={{ overflow: "hidden" }}
            >
              <span
                className="font-display"
                style={{ position: "absolute", left: 0, right: 0, top: H * 0.48, textAlign: "center", fontWeight: 800, fontSize: H * 0.2, letterSpacing: "0.02em", color: "rgba(60,38,14,.55)" }}
              >
                SooulOne
              </span>
              {more > 0 && (
                <span
                  style={{
                    position: "absolute",
                    right: W * 0.07,
                    bottom: H * 0.12,
                    minWidth: H * 0.36,
                    height: H * 0.36,
                    padding: "0 6px",
                    boxSizing: "border-box",
                    borderRadius: 999,
                    background: "#241c15",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: H * 0.2,
                  }}
                >
                  +{more}
                </span>
              )}
              <span
                className={motion}
                style={{
                  position: "absolute",
                  left: W * 0.08,
                  right: W * 0.08,
                  top: H * 0.14,
                  height: H * 0.16,
                  background: "#1f7a3d",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: H * 0.11,
                  letterSpacing: "0.14em",
                  opacity: complete ? 1 : 0,
                  transition: animate ? "opacity .3s ease .35s" : undefined,
                }}
              >
                COMPLETE
              </span>
            </Face>

            <Flap width={W} height={D * 0.42} wall={`rotateY(180deg) translateZ(${D / 2}px)`} angle={CARTON.backFlap} />
            <Flap width={D} height={W * 0.36} wall={`rotateY(-90deg) translateZ(${W / 2}px)`} angle={CARTON.sideFlap} />
            <Flap width={D} height={W * 0.36} wall={`rotateY(90deg) translateZ(${W / 2}px)`} angle={CARTON.sideFlap} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A combo the shop put together: two packs held by a green band, flat, so a
 * combo never looks like a box the shopper filled.
 */
export function ComboPicture({ pictures, size }: { pictures: readonly (string | null)[]; size: number }) {
  const [a, b] = [pictures[0] ?? null, pictures[1] ?? pictures[0] ?? null];
  const pack = (src: string | null, left: number, top: number, turn: number) => {
    const style: CSSProperties = { position: "absolute", left: size * left, top: size * top, width: size * 0.44, height: size * 0.62, border: "1px solid #fff", borderRadius: 2, transform: `rotate(${turn}deg)` };
    return src ? (
      <Image src={src} alt="" width={Math.round(size * 0.9)} height={Math.round(size * 1.24)} className="object-cover" style={style} />
    ) : (
      <span style={{ ...style, background: "#f2ede4" }} />
    );
  };
  return (
    <div aria-hidden className="relative shrink-0 self-start overflow-hidden border border-rule bg-surface" style={{ width: size, height: size }}>
      {pack(a, 0.11, 0.16, -5)}
      {pack(b, 0.45, 0.19, 5)}
      <span className="absolute bg-veg" style={{ left: size * 0.06, right: size * 0.06, top: size * 0.47, height: Math.max(4, size * 0.09), borderRadius: 1 }} />
    </div>
  );
}
