import { describe, expect, it } from "vitest";
import { Glow } from "../../filters/builtins";
import { GLOW_WGSL } from "../../filters/glow-wgsl";

// ---------------------------------------------------------------------------
// Unit test: the shape of the Glow fragment. Bun has no WebGPU, so the pixels
// are checked in a browser; here the text pins what makes the halo soft: the
// weighted mean source alpha over a disc of radius `distance`, the near probes
// counting most, every probe in the input frame, the source drawn over a
// premultiplied halo
// ---------------------------------------------------------------------------

/**
 * The value of a WGSL `f32` constant of the Glow fragment.
 *
 * @param name - The constant.
 * @returns Its value, or `NaN` when it is missing.
 */
function constant(name: string): number {
  const match = new RegExp(String.raw`const ${name}: f32 = (-?[\d.]+);`).exec(GLOW_WGSL);

  return Number(match?.[1] ?? Number.NaN);
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
    expect(GLOW_WGSL).toContain("let along = sqrt((f32(probeIndex) + 0.5) / f32(GLOW_PROBES));");
    expect(constant("GLOW_TURN_COS")).toBeCloseTo(Math.cos(golden), 12);
    expect(constant("GLOW_TURN_SIN")).toBeCloseTo(Math.sin(golden), 12);
  });

  it("draws the source over a premultiplied halo of coverage × strength × alpha", () => {
    expect(GLOW_WGSL).toContain(
      "let halo = clamp(coverage * fu.strength * fu.alpha, 0.0, 1.0) * (1.0 - source.a);"
    );
    expect(GLOW_WGSL).toContain("return source + vec4<f32>(fu.color * halo, halo);");
  });
});
