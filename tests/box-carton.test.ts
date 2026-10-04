import { describe, expect, it } from "vitest";
import { MAX_SHOWN, OUTLINE, cartonContents, cartonFit, packSpots } from "@/lib/box-carton";

/** The 3D box picture (src/lib/box-carton.ts): what it shows and how it fills a frame. */

describe("what the carton shows", () => {
  it("one pack per unit, in order, up to four, then +N", () => {
    expect(cartonContents([{ picture: "a", quantity: 1 }, { picture: "b", quantity: 2 }])).toEqual({ shown: ["a", "b", "b"], more: 0 });
    expect(cartonContents([{ picture: "a", quantity: 3 }, { picture: "b", quantity: 3 }])).toEqual({ shown: ["a", "a", "a", "b"], more: 2 });
    expect(cartonContents([{ picture: null, quantity: 1 }])).toEqual({ shown: [null], more: 0 });
    expect(cartonContents([])).toEqual({ shown: [], more: 0 });
  });

  it("stands the packs in a symmetrical fan inside the carton, never more than four", () => {
    expect(packSpots(0)).toEqual([]);
    expect(packSpots(1)).toEqual([expect.objectContaining({ x: 0, turn: 0 })]);
    const three = packSpots(3);
    expect(three.map((s) => s.x)).toEqual([-three[2].x, 0, three[2].x]);
    expect(three[1].z).toBeLessThan(three[0].z); // the middle one sits back
    expect(three.map((s) => s.turn)).toEqual([-9, 0, 9]);
    expect(packSpots(9)).toHaveLength(MAX_SHOWN);
    for (const n of [1, 2, 3, 4]) {
      const spots = packSpots(n);
      // Every pack stays between the carton's side walls (150 wide).
      for (const s of spots) expect(Math.abs(s.x) + s.width / 2).toBeLessThanOrEqual(75);
    }
  });
});

describe("fitting the carton to a frame", () => {
  it("fills the tight side to the padding and centres the drawing", () => {
    const fit = cartonFit(62, 62, 1);
    // Wider than tall, so width decides: 60 px of drawing in a 62 px frame.
    expect(OUTLINE.width * fit.scale).toBeCloseTo(60);
    const tall = (OUTLINE.above + OUTLINE.below) * fit.scale;
    const top = fit.top - OUTLINE.above * fit.scale;
    expect(top).toBeCloseTo((62 - tall) / 2); // same space above and below
    expect(fit.left).toBeCloseTo(-OUTLINE.rightOfCentre * fit.scale);
  });

  it("lets height decide in a wide frame, leaving room for the shadow when there is one", () => {
    const plain = cartonFit(400, 200, 6);
    expect((OUTLINE.above + OUTLINE.below) * plain.scale).toBeCloseTo(188);
    const shadowed = cartonFit(400, 200, 6, true);
    expect(shadowed.scale).toBeLessThan(plain.scale);
    expect((OUTLINE.above + OUTLINE.belowWithShadow) * shadowed.scale).toBeCloseTo(188);
  });

  it("never goes negative in a frame too small to hold it", () => {
    expect(cartonFit(1, 1, 4).scale).toBe(0);
  });
});
