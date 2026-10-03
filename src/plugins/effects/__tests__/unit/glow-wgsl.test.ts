import { describe, expect, it } from "vitest";
import { Glow } from "../../filters/builtins";
import { GLOW_WGSL } from "../../filters/glow-wgsl";

// ---------------------------------------------------------------------------
// Unit test: the shape of the Glow fragment. Bun has no WebGPU, so the pixels
// are checked in a browser; here the text pins what makes the halo soft: the
// weighted mean source alpha over a disc of radius `distance`, the near probes
// counting most, a probe count that grows with the radius in physical pixels,
// every probe in the input frame, the source drawn over a premultiplied halo
// ---------------------------------------------------------------------------

/**
 * The value of a WGSL `f32` or `i32` constant of the Glow fragment.
 *
 * @param name - The constant.
 * @returns Its value, or `NaN` when it is missing.
 */
function constant(name: string): number {
  const match = new RegExp(String.raw`const ${name}: [fi]32 = (-?[\d.]+);`).exec(GLOW_WGSL);

  return Number(match?.[1] ?? Number.NaN);
}

/**
 * The probe count the Glow fragment takes for a distance at a resolution, worked out from the
 * factor, the floor and the cap written in its WGSL.
 *
 * @param distance - The glow distance in logical pixels.
 * @param resolution - The device pixel ratio of the filter input.
 * @returns The probe count, or `NaN` when the count line is missing.
 */
function probeCount(distance: number, resolution: number): number {
  const match =
    /let probes = clamp\(i32\(ceil\(radiusPx \* radiusPx \* ([\d.]+)\)\), (\d+), GLOW_MAX_PROBES\);/.exec(
      GLOW_WGSL
    );
  const radiusPx = distance * resolution;
  const count = Math.ceil(radiusPx * radiusPx * Number(match?.[1] ?? Number.NaN));

  return Math.min(Math.max(count, Number(match?.[2] ?? Number.NaN)), constant("GLOW_MAX_PROBES"));
}

describe("the Glow fragment", () => {
  it("reads exactly the uniforms Glow declares", () => {
    const used = new Set([...GLOW_WGSL.matchAll(/\bfu\.(\w+)/g)].map(match => match[1]));

    expect(used).toEqual(new Set(Glow.filter.uniforms.map(uniform => uniform.name)));
  });

  it("keeps every probe inside the input frame", () => {
    const samples = [...GLOW_WGSL.matchAll(/textureSample\(uTexture, uSampler, (\w+)\)/g)];

    expect(samples.map(match => match[1])).toEqual(["uv", "probe"]);
    expect(GLOW_WGSL).toMatch(
      /let probe = clamp\([^;]*, gfu\.uInputClamp\.xy, gfu\.uInputClamp\.zw\);/
    );
  });

  it("takes the weighted mean alpha around the pixel, never the largest one", () => {
    expect(GLOW_WGSL).not.toMatch(/\bmax\(/);
    expect(GLOW_WGSL).toContain("coverage += textureSample(uTexture, uSampler, probe).a * weight;");
    expect(GLOW_WGSL).toContain("weights += weight;");
    expect(GLOW_WGSL).toContain("coverage /= weights;");
  });

  it("weights a probe by (1 - r / distance)², so the halo fades out with no band at the rim", () => {
    expect(GLOW_WGSL).toContain("let weight = (1.0 - along) * (1.0 - along);");
  });

  it("spreads the probes evenly over the disc of radius distance, none beyond it", () => {
    const golden = Math.PI * (3 - Math.sqrt(5));

    expect(GLOW_WGSL).toContain("let reach = gfu.uInputSize.zw * fu.distance;");
    expect(GLOW_WGSL).toContain("let along = sqrt((f32(probeIndex) + 0.5) / f32(probes));");
    expect(constant("GLOW_TURN_COS")).toBeCloseTo(Math.cos(golden), 12);
    expect(constant("GLOW_TURN_SIN")).toBeCloseTo(Math.sin(golden), 12);
  });

  it("counts the probes from the radius in physical pixels, read from uniforms only", () => {
    expect(GLOW_WGSL).toContain(
      "let radiusPx = fu.distance * gfu.uInputPixel.x * gfu.uInputSize.z;"
    );
    expect(GLOW_WGSL).toContain(
      "let probes = clamp(i32(ceil(radiusPx * radiusPx * 0.25)), 64, GLOW_MAX_PROBES);"
    );
    expect(probeCount(10, 3)).toBe(225);
  });

  it("never takes fewer than 64 probes, so a small glow at DPR 1 keeps today's pixels", () => {
    expect(probeCount(1, 1)).toBe(64);
    expect(probeCount(10, 1)).toBe(64);
    expect(probeCount(16, 1)).toBe(64);
    expect(probeCount(17, 1)).toBe(73);
  });

  it("caps the probes at 256, the constant bound of the loop", () => {
    expect(constant("GLOW_MAX_PROBES")).toBe(256);
    expect(GLOW_WGSL).toContain(
      "for (var probeIndex = 0; probeIndex < GLOW_MAX_PROBES; probeIndex++) {"
    );
    expect(probeCount(32, 3)).toBe(256);
    expect(probeCount(1000, 3)).toBe(256);
  });

  it("leaves the loop at the probe count before it samples, in uniform control flow", () => {
    const loop = GLOW_WGSL.slice(GLOW_WGSL.indexOf("for (var probeIndex"));
    const body = loop.slice(loop.indexOf("{") + 1).trimStart();

    expect(body).toMatch(/^if \(probeIndex >= probes\) \{ break; \}\n/);
  });

  it("draws the source over a premultiplied halo of coverage × strength × alpha", () => {
    expect(GLOW_WGSL).toContain(
      "let halo = clamp(coverage * fu.strength * fu.alpha, 0.0, 1.0) * (1.0 - source.a);"
    );
    expect(GLOW_WGSL).toContain("return source + vec4<f32>(fu.color * halo, halo);");
  });
});
