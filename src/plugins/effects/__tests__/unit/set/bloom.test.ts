import { describe, expect, it } from "vitest";
import type { FilterStep } from "../../../filters/types";
import { BLOOM_GLSL, BLOOM_WGSL, Bloom } from "../../../set/bloom";
import { BloomCut, Downsample, GaussAlong } from "../../../set/stages";
import type { BloomValue } from "../../../set/types";
import { bodyCases, headsOf } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Bloom` member of the set, the one that reads a second texture.
// Bun has no GPU: the pixels are the visual leg's
// (`tests/visual/effects-set.visual.ts`); here its definition, the text of its
// bodies and its chain, the ladder of steps the engine draws `bright` with.
// ---------------------------------------------------------------------------

/**
 * The steps of Bloom's chain for its defaults with some fields changed, at a resolution.
 *
 * @param value - The fields over the defaults.
 * @param resolution - Texels per CSS px of the view's input.
 * @returns What the chain answers.
 */
function chainOf(value: Partial<BloomValue>, resolution: number): readonly FilterStep[] {
  const input = Bloom.filter.inputs[0];

  if (input === undefined) throw new Error("Bloom reads no input");

  return input.chain({ ...Bloom().value, ...value }, { resolution });
}

/**
 * A ladder as the test reads it: each step's stage, its scale and its uniforms.
 *
 * @param steps - The chain's answer.
 * @returns One row per step.
 */
function ladderOf(steps: readonly FilterStep[]): Array<[string, number, object | undefined]> {
  return steps.map(step => [
    step.stage.filter.id,
    step.scale,
    step.uniforms && { ...step.uniforms }
  ]);
}

/** The 4-step ladder at sigma 8: the cut at ½, a box to ¼, the Gaussian along x and y at ¼. */
const FOUR_AT_8 = [
  ["effects.bloomCut", 0.5, { threshold: 0.7 }],
  ["effects.downsample", 0.25, undefined],
  ["effects.gaussAlong", 0.25, { dir: [1, 0], sigma: 8 }],
  ["effects.gaussAlong", 0.25, { dir: [0, 1], sigma: 8 }]
];

/** The 5-step ladder at sigma 8: one more box, to ⅛, and the Gaussian there. */
const FIVE_AT_8 = [
  ["effects.bloomCut", 0.5, { threshold: 0.7 }],
  ["effects.downsample", 0.25, undefined],
  ["effects.downsample", 0.125, undefined],
  ["effects.gaussAlong", 0.125, { dir: [1, 0], sigma: 8 }],
  ["effects.gaussAlong", 0.125, { dir: [0, 1], sigma: 8 }]
];

describe("Bloom", () => {
  bodyCases({ filter: Bloom.filter, wgsl: BLOOM_WGSL, glsl: BLOOM_GLSL, reads: ["strength"] });

  // Bug: the export's example lies: the defaults no longer take the 4-step ladder at resolution 2.
  it("answers the 4 steps of its example on the defaults", () => {
    expect(Bloom.filter.inputs[0]?.chain({ ...Bloom().value }, { resolution: 2 }).length).toBe(4);
  });

  // Bug: a chain member that claims the quad (no mesh binds a second texture), reads the screen, or is padded.
  it('is "local", reads one input `bright` drawn by its three stages, and has no quad and no padding', () => {
    expect(headsOf(BLOOM_WGSL)).toBe(1);
    expect(Bloom.filter.quadSource).toBeUndefined();
    expect(Bloom.filter.cache).toBe("local");
    expect(Bloom.filter.padding).toBe(0);
    expect(Bloom.filter.inputs.map(input => [input.name, input.sample, input.from])).toEqual([
      ["bright", "sampleBright", "input"]
    ]);
    expect(Bloom.filter.inputs[0]?.stages).toEqual([BloomCut, Downsample, GaussAlong]);
  });

  // Bug: the Gaussian at ¼ is asked for more than 8 texels (its taps band), or a wide radius grows the ladder past
  // its budget of 6 passes.
  it("at resolution 2: 4 steps at radius 16, 5 at radius 32 and at 128, sigma 8 on every one", () => {
    expect(ladderOf(chainOf({ radius: 16 }, 2))).toEqual(FOUR_AT_8);
    expect(ladderOf(chainOf({ radius: 32 }, 2))).toEqual(FIVE_AT_8);
    expect(ladderOf(chainOf({ radius: 128 }, 2))).toEqual(FIVE_AT_8);
  });

  // Bug: the switch to ⅛ reads the radius alone, not its texels: the phone's 2.625 draws the 4-step ladder at a sigma
  // over 8, and a small radius a Gaussian of 0 texels.
  it("takes the 5-step ladder at the phone's 2.625 for radius 16, and sigma follows the texels below the cap", () => {
    const steps = ladderOf(chainOf({ radius: 16 }, 2.625));

    expect(steps.map(([, scale]) => scale)).toEqual([0.5, 0.25, 0.125, 0.125, 0.125]);
    expect(steps.at(-1)?.[2]).toEqual({ dir: [0, 1], sigma: 5.25 });
    expect(ladderOf(chainOf({ radius: 4 }, 1)).at(-1)?.[2]).toEqual({ dir: [0, 1], sigma: 1 });
    expect(ladderOf(chainOf({ radius: 0 }, 2)).at(-1)?.[2]).toEqual({ dir: [0, 1], sigma: 0 });
  });

  // Bug: the threshold of the value never reaches the cut: every bloom cuts at 0.7.
  it("hands the value's threshold to the cut", () => {
    expect(ladderOf(chainOf({ threshold: 0.3 }, 2))[0]?.[2]).toEqual({ threshold: 0.3 });
  });

  // Bug: a ladder made per call: a strength tween runs the chain in every frame, and every frame allocates its steps.
  it("answers the same array, written in place, for every call of a ladder", () => {
    const first = chainOf({ threshold: 0.7 }, 2);
    const again = chainOf({ threshold: 0.5, strength: 1.4 }, 2);
    const wide = chainOf({ radius: 32 }, 2);

    expect(again).toBe(first);
    expect(first[0]?.uniforms).toEqual({ threshold: 0.5 });
    expect(wide).not.toBe(first);
    expect(chainOf({ radius: 32, strength: 0.2 }, 2)).toBe(wide);
    expect(chainOf({}, 2)).toBe(first);
  });

  // Bug: a step the engine refuses when it draws (a stage not listed, a uniform the stage does not declare or of
  // another form): the bloom breaks on its first frame, reason "chain".
  it("names only its listed stages in both ladders, with uniforms each declares in its form", () => {
    const stages = Bloom.filter.inputs[0]?.stages ?? [];

    for (const steps of [chainOf({}, 2), chainOf({ radius: 32 }, 2)]) {
      for (const step of steps) {
        expect(stages).toContain(step.stage);
        expect(step.scale).toBeGreaterThan(0);
        expect(step.scale).toBeLessThanOrEqual(1);

        for (const [name, field] of Object.entries(step.uniforms ?? {})) {
          const uniform = step.stage.filter.uniforms.find(candidate => candidate.name === name);

          expect(uniform, `${step.stage.filter.id}.${name}`).toBeDefined();
          expect(Array.isArray(field) ? field.length : 1).toBe(uniform?.size);
        }
      }
    }
  });
});
