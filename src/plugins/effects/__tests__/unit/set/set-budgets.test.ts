import { describe, expect, it } from "vitest";
import type { FilterComponent, FilterFields } from "../../../filters/types";
import { FLASH_GLSL, FLASH_WGSL, Flash } from "../../../set/flash";
import { GRADE_GLSL, GRADE_WGSL, Grade } from "../../../set/grade";
import { VIGNETTE_GLSL, VIGNETTE_WGSL, Vignette } from "../../../set/vignette";

// ---------------------------------------------------------------------------
// Unit test: the budget of every member of the set, from its definition and its
// own bodies (never `filter.source`, which carries the set head and its one
// read). Mpx = CSS area × resolution² × (1 + Σ scale²) of its chain's steps;
// the screen frame is the A26's 411 × 891 CSS px (assumed, delta spec "Words"),
// the tile 128 × 128; the bench runs at resolution 2. At 2 one pass over the
// screen is 411 × 891 × 4 = 1.4648 Mpx: the delta spec rounds it to 1.46.
// ---------------------------------------------------------------------------

/** A budget frame, CSS px. */
type Frame = { readonly width: number; readonly height: number };

/** The A26's viewport, as assumed until the first slice-1 run logs `viewport.size()`. */
const SCREEN: Frame = { width: 411, height: 891 };

/** One tile of a board. */
const TILE: Frame = { width: 128, height: 128 };

/** The resolution the bench and the budgets are read at: the renderer's default `maxResolution`. */
const RESOLUTION = 2;

/** A member, with the bodies the test counts in. */
type Row = {
  readonly member: FilterComponent<FilterFields>;
  readonly wgsl: string;
  readonly glsl: string;
};

/** Every member of slice 1. */
const MEMBERS: readonly Row[] = [
  { member: Flash, wgsl: FLASH_WGSL, glsl: FLASH_GLSL },
  { member: Grade, wgsl: GRADE_WGSL, glsl: GRADE_GLSL },
  { member: Vignette, wgsl: VIGNETTE_WGSL, glsl: VIGNETTE_GLSL }
];

/** What a member costs, as the README's table states it. */
type Budget = {
  readonly id: string;
  readonly passes: number;
  readonly mpx: number;
  readonly samples: number;
  readonly onChange: "quad" | "chain + stage 3" | "filter pass";
};

/**
 * The scales of a member's chain steps at a resolution, relative to its own: none without inputs.
 *
 * @param member - The member.
 * @param resolution - Texels per CSS px.
 * @returns The scales.
 */
function chainScales(member: FilterComponent<FilterFields>, resolution: number): number[] {
  const defaults = member().value as FilterFields;

  return member.filter.inputs.flatMap(input =>
    input.chain(defaults, { resolution }).map(step => step.scale)
  );
}

/**
 * The reads of the input in a body: one per `sampleInput(` call, a loop's bound when the call is in a loop.
 *
 * @param body - The member's own body, WGSL or GLSL.
 * @returns The samples a pixel takes.
 */
function samplesOf(body: string): number {
  const bound = /for \([^;]*; \w+ < (\d+);/.exec(body)?.[1];
  const calls = [...body.matchAll(/\bsampleInput\(/g)].length;

  return bound === undefined ? calls : calls * Number(bound);
}

/**
 * The budget of a member on a frame at a resolution.
 *
 * @param row - The member and its bodies.
 * @param frame - The frame.
 * @param resolution - Texels per CSS px.
 * @returns What it costs.
 */
function budgetOf(row: Row, frame: Frame, resolution: number): Budget {
  const { filter } = row.member;
  const scales = chainScales(row.member, resolution);
  const area = frame.width * frame.height * resolution * resolution;

  return {
    id: filter.id,
    passes: filter.inputs.length === 0 ? filter.passes : 1 + scales.length,
    mpx: (area * (1 + scales.reduce((sum, scale) => sum + scale * scale, 0))) / 1e6,
    samples: samplesOf(row.wgsl),
    onChange: onChangeOf(row.member)
  };
}

/**
 * What a value change of a member costs: its quad, its chain and stage 3, or a filter pass.
 *
 * @param member - The member.
 * @returns The cost, as the README's table words it.
 */
function onChangeOf(member: FilterComponent<FilterFields>): Budget["onChange"] {
  if (member.filter.quadSource !== undefined) return "quad";

  return member.filter.inputs.length > 0 ? "chain + stage 3" : "filter pass";
}

describe("the budgets of the set", () => {
  // Bug: a body that reads its input around the head: a sample no budget counts, a read off the clamp.
  it.each(MEMBERS)("$member.filter.id reads its input through sampleInput only", row => {
    expect(row.wgsl).not.toMatch(/\btextureSample(?:Level)?\s*\(/);
    expect(row.glsl).not.toMatch(/\btexture(?:Lod)?\s*\(/);
    expect(samplesOf(row.glsl)).toBe(samplesOf(row.wgsl));
  });

  // Bug: a member that silently left the quad, a body that gained a sample loop, a pass more than one.
  it.each(
    MEMBERS
  )("$member.filter.id: 1 pass, 1 sample, at most 1.465 Mpx a screen, quad on change", row => {
    const screen = budgetOf(row, SCREEN, RESOLUTION);

    expect(screen.passes).toBe(1);
    expect(screen.samples).toBe(1);
    expect(screen.mpx).toBeLessThanOrEqual(1.465);
    expect(screen.onChange).toBe("quad");
    expect(budgetOf(row, TILE, RESOLUTION).mpx).toBeLessThanOrEqual(0.066);
  });
});
