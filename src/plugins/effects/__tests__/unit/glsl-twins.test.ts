import { describe, expect, it } from "vitest";
import { Glow, Outline } from "../../filters/builtins";
import { GLOW_GLSL } from "../../filters/glow-glsl";
import { GLOW_WGSL } from "../../filters/glow-wgsl";
import { OUTLINE_GLSL } from "../../filters/outline-glsl";
import { OUTLINE_WGSL } from "../../filters/outline-wgsl";

// ---------------------------------------------------------------------------
// Unit test: the GLSL twins of Glow and Outline do the same math as their
// WGSL. Bun has no GPU, so the pixels are checked in a browser; here the text
// pins the constants, the probes, the weights and the final colour, line by
// line against the WGSL
// ---------------------------------------------------------------------------

/**
 * The value of a numeric constant of a shader body, WGSL or GLSL.
 *
 * @param body - The shader body.
 * @param name - The constant.
 * @returns Its value, or `NaN` when it is missing.
 */
function constant(body: string, name: string): number {
  const match = new RegExp(String.raw`const (?:\w+ )?${name}(?:: \w+)? = (-?[\d.]+);`).exec(body);

  return Number(match?.[1] ?? Number.NaN);
}

/**
 * The bare uniform names a GLSL body reads, out of the names a filter declares.
 *
 * @param body - The GLSL body.
 * @param declared - The declared uniform names.
 * @returns The names the body uses.
 */
function readsOf(body: string, declared: readonly string[]): string[] {
  return declared.filter(name => new RegExp(String.raw`\b${name}\b`).test(body));
}

/**
 * The probe count of a Glow body, WGSL or GLSL, with the language left out: the radius in
 * physical pixels with the `fu.` and `gfu.` prefixes dropped, then the argument of `ceil`, the
 * floor and the cap of the clamp.
 *
 * @param body - The shader body.
 * @returns The four parts, or `[]` when a line is missing.
 */
function countOf(body: string): string[] {
  const radius = /radiusPx = ([^;]+);/.exec(body);
  const count = /probes = clamp\(\w+\(ceil\(([^)]+)\)\), (\d+), (\w+)\);/.exec(body);

  if (!radius?.[1] || !count) return [];

  return [radius[1].replaceAll(/\bg?fu\./g, ""), ...count.slice(1)];
}

describe("the Glow GLSL", () => {
  it("defines main and reads every uniform Glow declares", () => {
    const names = Glow.filter.uniforms.map(uniform => uniform.name);

    expect(GLOW_GLSL).toMatch(/\bvoid\s+main\s*\(/);
    expect(readsOf(GLOW_GLSL, names)).toEqual(names);
  });

  it("uses the 256-probe bound and the golden-angle turn of the WGSL", () => {
    for (const name of ["GLOW_MAX_PROBES", "GLOW_TURN_COS", "GLOW_TURN_SIN"]) {
      expect(constant(GLOW_GLSL, name), name).toBe(constant(GLOW_WGSL, name));
    }

    expect(constant(GLOW_GLSL, "GLOW_MAX_PROBES")).toBe(256);
  });

  it("counts the probes from the radius in physical pixels as the WGSL does", () => {
    expect(GLOW_GLSL).toContain("float radiusPx = distance * uInputPixel.x * uInputSize.z;");
    expect(GLOW_GLSL).toContain(
      "int probes = clamp(int(ceil(radiusPx * radiusPx * 0.25)), 64, GLOW_MAX_PROBES);"
    );
    expect(countOf(GLOW_GLSL)).toEqual([
      "distance * uInputPixel.x * uInputSize.z",
      "radiusPx * radiusPx * 0.25",
      "64",
      "GLOW_MAX_PROBES"
    ]);
    expect(countOf(GLOW_GLSL)).toEqual(countOf(GLOW_WGSL));
  });

  it("loops to the constant bound and leaves at the probe count before it samples", () => {
    const loop = GLOW_GLSL.slice(GLOW_GLSL.indexOf("for (int probeIndex"));
    const body = loop.slice(loop.indexOf("{") + 1).trimStart();

    expect(GLOW_GLSL).toContain(
      "for (int probeIndex = 0; probeIndex < GLOW_MAX_PROBES; probeIndex++) {"
    );
    expect(body).toMatch(/^if \(probeIndex >= probes\) break;\n/);
  });

  it("spreads, weights and clamps the probes as the WGSL does", () => {
    expect(GLOW_GLSL).toContain("vec2 reach = uInputSize.zw * distance;");
    expect(GLOW_GLSL).toContain("float along = sqrt((float(probeIndex) + 0.5) / float(probes));");
    expect(GLOW_GLSL).toContain("float weight = (1.0 - along) * (1.0 - along);");
    expect(GLOW_GLSL).toContain(
      "vec2 probe = clamp(vTextureCoord + turn * reach * along, uInputClamp.xy, uInputClamp.zw);"
    );
    expect(GLOW_GLSL).toContain("coverage += texture(uTexture, probe).a * weight;");
    expect(GLOW_GLSL).toContain("coverage /= weights;");
  });

  it("draws the source over the same premultiplied halo", () => {
    expect(GLOW_GLSL).toContain(
      "float halo = clamp(coverage * strength * alpha, 0.0, 1.0) * (1.0 - source.a);"
    );
    expect(GLOW_GLSL).toContain("finalColor = source + vec4(color * halo, halo);");
  });
});

describe("the Outline GLSL", () => {
  it("defines main and reads every uniform Outline declares", () => {
    const names = Outline.filter.uniforms.map(uniform => uniform.name);

    expect(OUTLINE_GLSL).toMatch(/\bvoid\s+main\s*\(/);
    expect(readsOf(OUTLINE_GLSL, names)).toEqual(names);
  });

  it("walks the same ring: 8 spokes, 12 from 6 px, the largest alpha", () => {
    expect(constant(OUTLINE_GLSL, "OUTLINE_TAU")).toBe(constant(OUTLINE_WGSL, "OUTLINE_TAU"));
    expect(OUTLINE_WGSL).toContain("let spokes = select(8, 12, fu.thickness >= 6.0);");
    expect(OUTLINE_GLSL).toContain("int spokes = thickness >= 6.0 ? 12 : 8;");
    expect(OUTLINE_GLSL).toContain("float turn = OUTLINE_TAU * float(spoke) / float(spokes);");
    expect(OUTLINE_GLSL).toContain(
      "vTextureCoord + vec2(cos(turn), sin(turn)) * texel * thickness,"
    );
    expect(OUTLINE_GLSL).toContain("edge = max(edge, texture(uTexture, probe).a);");
  });

  it("draws the source over the same premultiplied ring", () => {
    expect(OUTLINE_GLSL).toContain("float line = edge * alpha;");
    expect(OUTLINE_GLSL).toContain(
      "finalColor = source + vec4(color * line, line) * (1.0 - source.a);"
    );
  });
});
