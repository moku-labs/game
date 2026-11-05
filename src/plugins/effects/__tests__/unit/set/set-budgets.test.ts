import { describe, expect, it } from "vitest";
import type { FilterComponent, FilterFields } from "../../../filters/types";
import { AURA_GLSL, AURA_WGSL, Aura } from "../../../set/aura";
import { BLOOM_GLSL, BLOOM_WGSL, Bloom } from "../../../set/bloom";
import { DISSOLVE_GLSL, DISSOLVE_WGSL, Dissolve } from "../../../set/dissolve";
import { FLASH_GLSL, FLASH_WGSL, Flash } from "../../../set/flash";
import { FOLD_GLSL, FOLD_WGSL, Fold } from "../../../set/fold";
import { GRADE_GLSL, GRADE_WGSL, Grade } from "../../../set/grade";
import { REVEAL_LINE_GLSL, REVEAL_LINE_WGSL, RevealLine } from "../../../set/reveal-line";
import { REVEAL_ROUND_GLSL, REVEAL_ROUND_WGSL, RevealRound } from "../../../set/reveal-round";
import { SHINE_GLSL, SHINE_WGSL, Shine } from "../../../set/shine";
import { VIGNETTE_GLSL, VIGNETTE_WGSL, Vignette } from "../../../set/vignette";

// ---------------------------------------------------------------------------
// Unit test: the budget of every member of the set, from its definition and its
// own bodies (never `filter.source`, which carries the set head and its one
// read). Mpx = CSS area × resolution² × (1 + Σ scale²) of its chain's steps;
// the screen frame is the A26's 384 × 693 CSS px (Chrome's viewport, read on the phone on 2026-11-04),
// the tile 128 × 128; the bench runs at resolution 2. At 2 one pass over the
// screen is 384 × 693 × 4 = 1.0644 Mpx. A padded member draws its frame grown
// by the padding on every side, as Pixi pads it, at its default padding; on the
// screen Pixi cuts the frame to the screen.
// ---------------------------------------------------------------------------

/** A budget frame, CSS px. */
type Frame = { readonly width: number; readonly height: number };

/** The A26's viewport, as assumed until the first slice-1 run logs `viewport.size()`. */
const SCREEN: Frame = { width: 384, height: 693 };

/** One tile of a board. */
const TILE: Frame = { width: 128, height: 128 };

/** The resolution the bench and the budgets are read at: the renderer's default `maxResolution`. */
const RESOLUTION = 2;

/** A member, with the bodies the test counts in and the samples of the member table. */
type Row = {
  readonly member: FilterComponent<FilterFields>;
  readonly wgsl: string;
  readonly glsl: string;
  readonly samples: number;
  /** The most Mpx it draws on a tile at resolution 2: a padded member pays its padding. */
  readonly tile: number;
};

/**
 * Every single-pass member of slices 1 and 2. `Aura` reads its pixel and 12 probes on a ring; `Aura` (at its default
 * `spread` 8) and `Fold` are padded by 8 px: a tile's frame is 144 × 144, 0.083 Mpx at 2.
 */
const MEMBERS: readonly Row[] = [
  { member: Flash, wgsl: FLASH_WGSL, glsl: FLASH_GLSL, samples: 1, tile: 0.066 },
  { member: Grade, wgsl: GRADE_WGSL, glsl: GRADE_GLSL, samples: 1, tile: 0.066 },
  { member: Vignette, wgsl: VIGNETTE_WGSL, glsl: VIGNETTE_GLSL, samples: 1, tile: 0.066 },
  { member: RevealLine, wgsl: REVEAL_LINE_WGSL, glsl: REVEAL_LINE_GLSL, samples: 1, tile: 0.066 },
  {
    member: RevealRound,
    wgsl: REVEAL_ROUND_WGSL,
    glsl: REVEAL_ROUND_GLSL,
    samples: 1,
    tile: 0.066
  },
  { member: Dissolve, wgsl: DISSOLVE_WGSL, glsl: DISSOLVE_GLSL, samples: 1, tile: 0.066 },
  { member: Shine, wgsl: SHINE_WGSL, glsl: SHINE_GLSL, samples: 1, tile: 0.066 },
  { member: Aura, wgsl: AURA_WGSL, glsl: AURA_GLSL, samples: 13, tile: 0.083 },
  { member: Fold, wgsl: FOLD_WGSL, glsl: FOLD_GLSL, samples: 1, tile: 0.083 }
];

/** The phone's full resolution: the A26's device pixel ratio, past the bench's `maxResolution` 2. */
const PHONE_RESOLUTION = 2.625;

/** The member that reads a second texture: its own body takes one sample, its chain the rest. */
const BLOOM: Row = { member: Bloom, wgsl: BLOOM_WGSL, glsl: BLOOM_GLSL, samples: 1, tile: 0.1 };

/**
 * Bloom on a tile at the bench's 2 and at the phone's 2.625: the 4-step ladder (½, ¼, ¼, ¼), 5 passes, 0.094 Mpx;
 * at 2.625 radius 16 is 10.5 texels at ¼, over 8, so the 5-step ladder (½, ¼, ⅛, ⅛, ⅛), 6 passes, 0.153 Mpx.
 */
const BLOOM_ROWS = [
  { frame: TILE, resolution: RESOLUTION, passes: 5, mpx: 0.1 },
  { frame: TILE, resolution: PHONE_RESOLUTION, passes: 6, mpx: 0.16 }
] as const;

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
 * The text between a `{` and the `}` that closes it.
 *
 * @param body - The text.
 * @param open - Where the `{` stands.
 * @returns What it holds.
 */
function blockAt(body: string, open: number): string {
  let depth = 0;

  for (let at = open; at < body.length; at += 1) {
    if (body[at] === "{") depth += 1;
    if (body[at] === "}") depth -= 1;
    if (depth === 0) return body.slice(open + 1, at);
  }

  return body.slice(open + 1);
}

/**
 * The `sampleInput(` calls in a text.
 *
 * @param text - A body, or a block of it.
 * @returns How many.
 */
function callsIn(text: string): number {
  return [...text.matchAll(/\bsampleInput\(/g)].length;
}

/**
 * The reads of the input in a body: one per `sampleInput(` call, times a loop's bound for a call inside the loop.
 *
 * @param body - The member's own body, WGSL or GLSL.
 * @returns The samples a pixel takes.
 */
function samplesOf(body: string): number {
  let samples = callsIn(body);

  for (const loop of body.matchAll(/for \([^;]*; \w+ < (\d+);[^{]*\{/g)) {
    const inside = callsIn(blockAt(body, (loop.index ?? 0) + loop[0].length - 1));

    samples += inside * (Number(loop[1]) - 1);
  }

  return samples;
}

/**
 * The padding a member's frame grows by on every side, CSS px: its number, or its uniform's default; Pixi pads by the
 * whole pixels of it.
 *
 * @param member - The member.
 * @returns The padding.
 */
function paddingOf(member: FilterComponent<FilterFields>): number {
  const { padding } = member.filter;
  const value = typeof padding === "number" ? padding : member().value[padding];

  return Math.trunc(typeof value === "number" ? value : 0);
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
  const padding = paddingOf(row.member);
  const width = Math.min(frame.width + 2 * padding, SCREEN.width);
  const height = Math.min(frame.height + 2 * padding, SCREEN.height);
  const area = width * height * resolution * resolution;

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
  it.each([
    ...MEMBERS,
    BLOOM
  ])("$member.filter.id reads its input through sampleInput only", row => {
    expect(row.wgsl).not.toMatch(/\btextureSample(?:Level)?\s*\(/);
    expect(row.glsl).not.toMatch(/\btexture(?:Lod)?\s*\(/);
    expect(samplesOf(row.glsl)).toBe(samplesOf(row.wgsl));
  });

  // Bug: a member that silently left the quad, a body that gained a sample loop, a pass more than one.
  it.each(
    MEMBERS
  )("$member.filter.id: 1 pass, $samples samples, at most 1.065 Mpx a screen, quad on change", row => {
    const screen = budgetOf(row, SCREEN, RESOLUTION);

    expect(screen.passes).toBe(1);
    expect(screen.samples).toBe(row.samples);
    expect(screen.mpx).toBeLessThanOrEqual(1.065);
    expect(screen.onChange).toBe("quad");
    expect(budgetOf(row, TILE, RESOLUTION).mpx).toBeLessThanOrEqual(row.tile);
  });

  // Bug: a chain that grew a step at the phone's resolution, a body that gained a sample, or a chain member that
  // claims the quad: a value change of it runs the chain and stage 3, a pass for each step.
  it.each(
    BLOOM_ROWS
  )("Bloom on a tile at $resolution: $passes passes, at most $mpx Mpx, the chain and stage 3 on change", row => {
    const tile = budgetOf(BLOOM, row.frame, row.resolution);

    expect(tile.passes).toBe(row.passes);
    expect(tile.mpx).toBeLessThanOrEqual(row.mpx);
    expect(tile.samples).toBe(BLOOM.samples);
    expect(tile.onChange).toBe("chain + stage 3");
  });
});
