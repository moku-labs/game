import { describe, expect, it } from "vitest";
import { WAVE_GLSL, WAVE_WGSL, Wave } from "../../../set/wave";
import { evaluate, type Vec2 } from "./body-eval";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Wave` member of the set. Bun has no GPU: the pixels are the
// visual leg's (`tests/visual/effects-set.visual.ts`, at amplitude 0 the view
// is its source); here its definition, the text of its bodies, and its lines
// evaluated on the CPU: the way it sways, its offset over a turn of phase, and
// which sources are inside the view.
// ---------------------------------------------------------------------------

/**
 * The number of the `WAVE_TAU` constant of a body, WGSL or GLSL.
 *
 * @param body - The body.
 * @returns The number, or `undefined` when the constant is missing.
 */
function tauOf(body: string): number | undefined {
  const match = /WAVE_TAU(?:: f32)? = ([\d.]+);/.exec(body);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** The scope of the body's constant. */
const TAU = { WAVE_TAU: tauOf(WAVE_WGSL) ?? Number.NaN };

/**
 * The offset of the body at a place across the wave.
 *
 * @param along - The place across the wave, CSS px.
 * @param value - The member's amplitude, wavelength and phase.
 * @param value.amplitude - The most it moves, CSS px.
 * @param value.wavelength - One wave, CSS px.
 * @param value.phase - The shift, radians.
 * @returns The offset, CSS px.
 */
function offsetAt(
  along: number,
  value: { amplitude: number; wavelength: number; phase: number }
): number {
  return evaluate(WAVE_WGSL, { from: "o", to: "o" }, { ...TAU, along, ...value });
}

describe("Wave", () => {
  memberCases({ member: Wave, wgsl: WAVE_WGSL, glsl: WAVE_GLSL, padding: 0 });

  // Bug: the table's defaults are lost, or the example lies.
  it("takes the fields of its example", () => {
    expect(Wave({ amplitude: 3 }).value).toEqual({
      amplitude: 3,
      wavelength: 48,
      phase: 0,
      angle: 0,
      enabled: true,
      order: 0
    });
  });

  // Bug: the GLSL wave runs at another length than the WGSL one: WebGL phones draw another ripple.
  it("turns by the same full turn in both languages", () => {
    expect(tauOf(WAVE_WGSL)).toBeCloseTo(2 * Math.PI, 12);
    expect(tauOf(WAVE_GLSL)).toBe(tauOf(WAVE_WGSL));
  });

  // Bug: angle 0 sways the columns, or the wave runs along the way it sways: a shear, not a ripple.
  it("sways rows left and right at angle 0 and columns up and down at π/2", () => {
    const px = { x: 10, y: 30 };
    const sway = (angle: number): { dir: Vec2; along: number } => ({
      dir: evaluate(WAVE_WGSL, { from: "dir", to: "dir" }, { angle }) as unknown as Vec2,
      along: evaluate(WAVE_WGSL, { from: "dir", to: "along" }, { angle, px })
    });

    expect(sway(0).dir).toEqual({ x: 1, y: 0 });
    expect(sway(0).along).toBe(30);
    expect(sway(Math.PI / 2).dir.x).toBeCloseTo(0, 12);
    expect(sway(Math.PI / 2).dir.y).toBe(1);
    expect(sway(Math.PI / 2).along).toBeCloseTo(-10, 12);
  });

  // Bug: the phase scaled (by TAU, or by the wavelength): the loop tween to 2π jumps when it starts again; or the
  // wavelength read as a frequency.
  it("moves by amplitude a quarter wave out, and comes back whole after a full turn of phase", () => {
    const value = { amplitude: 4, wavelength: 48, phase: 0 };

    expect(offsetAt(12, value)).toBeCloseTo(4, 12);
    expect(offsetAt(0, value)).toBeCloseTo(0, 12);

    for (const along of [0, 7, 19.5, 100]) {
      expect(offsetAt(along, { ...value, phase: 2 * Math.PI })).toBeCloseTo(
        offsetAt(along, value),
        9
      );
    }

    expect(offsetAt(12, { ...value, amplitude: 0 })).toBe(0);
    expect(Number.isFinite(offsetAt(12, { ...value, wavelength: 0 }))).toBe(true);
  });

  // Bug: a source outside the view reads its clamped edge (the edge smeared into a band), or the last row of a view
  // at amplitude 0, whose place rounds a hair past 1, goes transparent.
  it("is transparent where its source is outside the view, and keeps a source a hair past the edge", () => {
    const insideAt = (q: Vec2): number =>
      evaluate(WAVE_WGSL, { from: "away", to: "inside" }, { q });

    expect(insideAt({ x: 1 + 1e-7, y: 0.5 })).toBe(1);
    expect(insideAt({ x: 0, y: 1 })).toBe(1);
    expect(insideAt({ x: 1.01, y: 0.5 })).toBe(0);
    expect(insideAt({ x: 0.5, y: -0.01 })).toBe(0);
    expect(WAVE_WGSL).toContain("return sampleInput(q) * inside;");
  });
});
