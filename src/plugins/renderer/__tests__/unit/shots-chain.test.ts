import { describe, expect, it } from "vitest";
import { blurData, boxData, gaussianTaps, hopsOf, sigmaOf } from "../../shots/chain";

// ---------------------------------------------------------------------------
// Unit: the arithmetic of a take, on literals. Which textures the chain goes through, how one axis of the Gaussian
// folds into bilinear taps, and what a pass finds in its uniform. Whether the GPU does what they say is the real Chrome
// page of the design folder.
// ---------------------------------------------------------------------------

describe("hopsOf", () => {
  // Bug: the first hop is not a quarter of the canvas, or the rounding goes down, so a hop drops a row of source pixels.
  it("divides the canvas by 4, rounding up, then ends at the shot", () => {
    expect(hopsOf(1080, 2340, 96, 208)).toEqual([
      { width: 270, height: 585 },
      { width: 96, height: 208 }
    ]);
    expect(hopsOf(1081, 2341, 96, 208)).toEqual([
      { width: 271, height: 586 },
      { width: 96, height: 208 }
    ]);
  });

  // Bug: only one hop is taken, so a 4K canvas reaches the shot in one pass of 3 x 3 taps and aliases.
  it("takes every hop the canvas allows", () => {
    expect(hopsOf(3840, 8320, 96, 208)).toEqual([
      { width: 960, height: 2080 },
      { width: 240, height: 520 },
      { width: 96, height: 208 }
    ]);
  });

  // Bug: a hop smaller than the shot is made, and the shot is scaled up from it: a coarse picture.
  it("goes straight to the shot from a canvas smaller than 4 x the shot", () => {
    expect(hopsOf(300, 650, 96, 208)).toEqual([{ width: 96, height: 208 }]);
  });

  // Bug: the loop looks at one axis only, and the other falls below the shot.
  it("stops when one axis would fall below the shot", () => {
    expect(hopsOf(2000, 800, 96, 208)).toEqual([{ width: 96, height: 208 }]);
  });

  // Bug: an exact multiple gets the shot's size twice: an empty pass from a texture of that size onto the shot.
  it("ends on the hop of an exact multiple, without a second one of that size", () => {
    expect(hopsOf(384, 832, 96, 208)).toEqual([{ width: 96, height: 208 }]);
  });

  // Bug: a hop lands next to the shot's size, the last pass averages nothing, and the picture aliases.
  it("takes no hop that leaves the last pass a ratio below 2", () => {
    expect(hopsOf(1080, 2340, 67, 147)).toEqual([
      { width: 270, height: 585 },
      { width: 67, height: 147 }
    ]);
    expect(hopsOf(768, 1664, 96, 208)).toEqual([
      { width: 192, height: 416 },
      { width: 96, height: 208 }
    ]);
    expect(hopsOf(764, 1660, 96, 208)).toEqual([{ width: 96, height: 208 }]);
  });
});

/**
 * The weight a kernel sums to: the centre, and every other tap on both sides.
 *
 * @param sigma - The sigma.
 * @returns The sum.
 */
function sumOf(sigma: number): number {
  return gaussianTaps(sigma).reduce(
    (sum, tap) => sum + (tap.offset === 0 ? tap.weight : 2 * tap.weight),
    0
  );
}

describe("gaussianTaps", () => {
  // Bug: a blur of 0 draws two passes of nothing, or divides by 0.
  it("gives no taps for a sigma of 0", () => {
    expect(gaussianTaps(0)).toEqual([]);
  });

  // Bug: a kernel that sums to more or less than 1 brightens or darkens the shot.
  it.each([0.4, 1.96, 5.4, 10])("sums to 1 at sigma %d", sigma => {
    expect(sumOf(sigma)).toBeCloseTo(1, 10);
  });

  // Bug: a pair is sampled at its middle, not at its weights' centre, so the curve bends and the blur is lopsided.
  it("pairs neighbouring texels into one tap at their weights' centre", () => {
    const taps = gaussianTaps(1);

    // Radius 3: the centre, the pair 1 and 2, and 3 alone (its partner lies outside the radius).
    expect(taps).toHaveLength(3);
    expect(taps[0]?.offset).toBe(0);
    expect(taps[1]?.offset).toBeCloseTo(
      (Math.exp(-0.5) + 2 * Math.exp(-2)) / (Math.exp(-0.5) + Math.exp(-2)),
      10
    );
    expect(taps[2]?.offset).toBe(3);
    expect((taps[1]?.weight ?? 0) / (taps[2]?.weight ?? 1)).toBeCloseTo(
      (Math.exp(-0.5) + Math.exp(-2)) / Math.exp(-4.5),
      10
    );
  });

  // Bug: the kernel outgrows the 16 taps of the uniform, and the blur reads past its array.
  it("holds 16 taps at the cap of the sigma, and never more", () => {
    expect(gaussianTaps(10)).toHaveLength(16);
    expect(gaussianTaps(40).length).toBeLessThanOrEqual(16);
    expect(sumOf(40)).toBeCloseTo(1, 10);
  });

  // Bug: a sigma so small that the neighbour's weight is 0 divides 0 by 0, and a NaN offset blacks the shot out.
  it("keeps no tap of no weight", () => {
    expect(gaussianTaps(0.001)).toEqual([{ offset: 0, weight: 1 }]);
  });
});

describe("sigmaOf", () => {
  // Bug: the sigma stays in reference units, or follows the canvas, so the softness changes from screen to screen.
  it("turns reference units of the frame's width into texels of the shot", () => {
    expect(sigmaOf(22, 96, 1080)).toBeCloseTo(1.9556, 3);
    expect(sigmaOf(22, 96, 1440)).toBeCloseTo(1.4667, 3);
    expect(sigmaOf(0, 96, 1080)).toBe(0);
  });

  // Bug: the cap is missing, and a wide blur on a large shot takes a kernel the uniform cannot hold.
  it("caps at 10 texels", () => {
    expect(sigmaOf(22, 512, 1080)).toBe(10);
  });

  // Bug: a mount of no size divides by 0, and a NaN sigma blacks the shot out.
  it("is no blur while there is no frame", () => {
    expect(sigmaOf(22, 96, 0)).toBe(0);
    expect(sigmaOf(0, 96, 0)).toBe(0);
  });
});

describe("boxData", () => {
  // Bug: the steps of a hop are not +-1 source pixel, and the 2 x 2 taps miss the texel corners: no exact box of 4 x 4.
  it("gives a hop of a factor of 4 two taps a side at +-1 source pixel", () => {
    const data = boxData({ width: 1080, height: 2340 }, { width: 270, height: 585 }, false);

    expect([...data.subarray(2, 7)]).toEqual([2, 2, 270, 585, 2]);
    expect(data[0]).toBeCloseTo(1 / 1080, 8);
    expect(data[1]).toBeCloseTo(1 / 2340, 8);
  });

  // Bug: the last hop keeps a step of 1, or one ratio for both axes, and a shot of another shape samples unevenly.
  it("gives the last hop three taps a side, a third of the ratio apart on each axis", () => {
    const data = boxData({ width: 270, height: 585 }, { width: 96, height: 195 }, true);

    expect(data[2]).toBeCloseTo(270 / 96 / 3, 5);
    expect(data[3]).toBeCloseTo(1, 5);
    expect(data[6]).toBe(3);
  });

  // Bug: an exact multiple ends on 3 x 3 taps where 2 x 2 give the exact box, and the shot weighs its texels unevenly.
  it("keeps two taps on a last hop of exactly 4", () => {
    const data = boxData({ width: 384, height: 832 }, { width: 96, height: 208 }, true);

    expect([...data.subarray(2, 7)]).toEqual([2, 2, 96, 208, 2]);
  });
});

describe("blurData", () => {
  const size = { width: 96, height: 208 };

  // Bug: both passes blur along x, and the shot smears sideways.
  it("steps one texel along the axis of the pass only", () => {
    const horizontal = blurData(size, "x", gaussianTaps(1));
    const vertical = blurData(size, "y", gaussianTaps(1));

    expect(horizontal[0]).toBeCloseTo(1 / 96, 8);
    expect(horizontal[1]).toBe(0);
    expect(vertical[0]).toBe(0);
    expect(vertical[1]).toBeCloseTo(1 / 208, 8);
  });

  // Bug: the taps sit where the WGSL struct does not read them: an array of vec4f starts at byte 32, stride 16.
  it("lays the taps out as the shader's struct reads them", () => {
    const taps = gaussianTaps(1);
    const data = blurData(size, "x", taps);

    expect(data.byteLength).toBe(288);
    expect([data[2], data[3], data[4]]).toEqual([96, 208, 3]);
    expect(data[8]).toBeCloseTo(taps[0]?.offset ?? -1, 5);
    expect(data[9]).toBeCloseTo(taps[0]?.weight ?? -1, 5);
    expect(data[12]).toBeCloseTo(taps[1]?.offset ?? -1, 5);
    expect(data[13]).toBeCloseTo(taps[1]?.weight ?? -1, 5);
    expect(data[16]).toBeCloseTo(taps[2]?.offset ?? -1, 5);
  });
});
