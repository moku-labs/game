import { describe, expect, it } from "vitest";
import type { FilterStep } from "../../../filters/types";
import { FROST_GLSL, FROST_WGSL, Frost, MAX_BLUR } from "../../../set/frost";
import type { FrostValue } from "../../../set/types";
import { bodyCases, headsOf } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Frost` member of the set (F126 stage 5), a backdrop whose
// input `blur` starts from back. Bun has no GPU: the look is the visual leg's
// (`tests/visual/frost-source.visual.ts`); here its definition, its bodies and
// the ladder its chain answers on the canvas and on a Source.
// ---------------------------------------------------------------------------

/**
 * The steps of Frost's chain for its defaults with some fields changed, at a resolution.
 *
 * @param value - The fields over the defaults.
 * @param resolution - Texels per CSS px of what was drawn under the window.
 * @returns What the chain answers.
 */
function chainOf(value: Partial<FrostValue>, resolution: number): readonly FilterStep[] {
  const input = Frost.filter.inputs[0];

  if (input === undefined) throw new Error("Frost reads no input");

  return input.chain({ ...Frost().value, ...value }, { resolution });
}

/**
 * The texels per CSS px the last step of a ladder draws at, and its sigma: what the glass looks like.
 *
 * @param steps - The chain's answer.
 * @param resolution - The resolution it was asked at.
 * @returns The density and the sigma in CSS px.
 */
function lookOf(steps: readonly FilterStep[], resolution: number): [number, number] {
  const last = steps.at(-1);
  const density = resolution * (last?.scale ?? 1);
  const sigma = Number(last?.uniforms?.sigma ?? 0);

  return [density, sigma / density];
}

describe("Frost", () => {
  bodyCases({ filter: Frost.filter, wgsl: FROST_WGSL, glsl: FROST_GLSL, reads: ["tint"] });

  // Bug: the member is no backdrop, or its input reads the view: no Source can feed it and the quad has no back.
  it("is a backdrop of one input from back, 12 and white by default, with a quad that names the back", () => {
    expect(Frost.filter.backdrop).toBe(true);
    expect(Frost.filter.cache).toBe("screen");
    expect(Frost().value).toEqual({ blur: 12, tint: 0xff_ff_ff, enabled: true, order: 0 });
    expect(Frost.filter.inputs.map(input => [input.name, input.from, input.offset?.name])).toEqual([
      ["blur", "back", "blurOffset"]
    ]);
    expect(headsOf(FROST_WGSL)).toBe(1);
    expect(Frost.filter.quadSource).toContain(
      "@group(3) @binding(3) var uBackTexture: texture_2d<f32>;"
    );
  });

  // Bug: the glass over a Source reads another blur than on the backdrop path: the chain draws at another density on a
  // Source at ¼ than on the canvas, or gives a sigma in CSS px that differs.
  it.each([
    2, 2.625, 3
  ])("draws the same density and sigma on the canvas at %s and on a Source at ¼ of it", r => {
    const canvas = lookOf(chainOf({}, r), r);
    const source = lookOf(chainOf({}, r * 0.25), r * 0.25);

    expect(source[0]).toBeCloseTo(canvas[0], 6);
    expect(source[1]).toBeCloseTo(canvas[1], 6);
    expect(canvas[1]).toBeCloseTo(12, 6);
  });

  // Bug: a blur past the range widens the rings off the picture, or a negative one draws a chain of nothing (A10).
  it("clamps blur to 0..48: 100 draws as 48, and 0 or less runs no chain", () => {
    expect(chainOf({ blur: 100 }, 2).map(step => [step.scale, { ...step.uniforms }])).toEqual(
      chainOf({ blur: MAX_BLUR }, 2).map(step => [step.scale, { ...step.uniforms }])
    );
    expect(chainOf({ blur: 0 }, 2)).toEqual([]);
    expect(chainOf({ blur: -4 }, 2)).toEqual([]);
  });

  // Bug: a wide blur asks the 13-tap blur for more than 8 texels: its rings stand apart, a ringed glass.
  it("keeps sigma at most 8 texels at its scale, halving the scale for a wide blur", () => {
    for (const blur of [1, 12, 24, 48]) {
      for (const r of [0.5, 2, 2.625]) {
        const sigma = Number(chainOf({ blur }, r).at(-1)?.uniforms?.sigma ?? 0);

        expect(sigma).toBeLessThanOrEqual(8);
      }
    }
  });
});
