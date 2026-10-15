import { describe, expect, it } from "vitest";
import { Glow, Outline } from "../../filters/builtins";
import { defineFilter, readsScreen } from "../../filters/define";
import { assembleGlsl } from "../../filters/glsl";
import type { FilterStep } from "../../filters/types";
import { assemble } from "../../filters/wgsl";

// ---------------------------------------------------------------------------
// The kept category of a filter (spec 23 P8, LEAD-FIXES-4 item 3): the option
// `cache` decides, default "local"; a body that reads the screen and declares
// nothing is drawn live; `canvasPixel(uv)` makes a body "placed" and gives it
// the engine's `keptOrigin`. Only the game's bodies are read, never the header.
// ---------------------------------------------------------------------------

/** A body that reads only its own pixels. */
const PLAIN =
  "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv); }";

/** Its GLSL twin. */
const PLAIN_GLSL = "void main() { finalColor = texture(uTexture, vTextureCoord); }";

/**
 * A WGSL body that computes something from `read` and returns the input.
 *
 * @param read - The expression the body reads.
 * @returns The body.
 */
function wgslReading(read: string): string {
  return `@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { let p = ${read}; return textureSample(uTexture, uSampler, uv + p * 0.0); }`;
}

describe("the kept category of a filter", () => {
  it.each([
    ["uGlobalFrame", wgslReading("gfu.uGlobalFrame.xy")],
    [
      "@builtin(position)",
      "@fragment fn mainFragment(@builtin(position) at: vec4<f32>, @location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv + at.xy * 0.0); }"
    ],
    ["uOutputTexture", wgslReading("gfu.uOutputTexture.xy")],
    ["uOutputFrame.xy", wgslReading("gfu.uOutputFrame.xy + uv * gfu.uInputSize.xy")]
  ])("a body reading %s and declaring nothing is drawn live", (_read, wgsl) => {
    const filter = defineFilter("fx.screen", { wgsl, glsl: PLAIN_GLSL });

    expect(filter.filter.cache).toBe("screen");
    expect(readsScreen(filter.filter)).toBe(true);
  });

  it("a GLSL body reading gl_FragCoord is drawn live", () => {
    const filter = defineFilter("fx.frag", {
      wgsl: PLAIN,
      glsl: "void main() { finalColor = texture(uTexture, vTextureCoord + gl_FragCoord.xy * 0.0); }"
    });

    expect(filter.filter.cache).toBe("screen");
  });

  it("uOutputFrame.zw stays local, and a read inside a comment does not count", () => {
    const size = defineFilter("fx.size", {
      wgsl: wgslReading("gfu.uOutputFrame.zw"),
      glsl: PLAIN_GLSL
    });
    const commented = defineFilter("fx.commented", {
      wgsl: `// was: gfu.uOutputFrame.xy\n/* gl_FragCoord @builtin(position) */\n${PLAIN}`,
      glsl: PLAIN_GLSL
    });

    expect(size.filter.cache).toBe("local");
    expect(commented.filter.cache).toBe("local");
    expect(readsScreen(commented.filter)).toBe(false);
  });

  it("the engine's header never makes a filter screen", () => {
    const filter = defineFilter("fx.plain", { wgsl: PLAIN, glsl: PLAIN_GLSL });

    expect(filter.filter.source).toContain("@builtin(position)");
    expect(filter.filter.cache).toBe("local");
  });

  it("a body calling canvasPixel is placed, gets keptOrigin and the helper; a body without it is byte-identical", () => {
    const wgsl = wgslReading("canvasPixel(uv)");
    const glsl =
      "void main() { vec2 canvas = canvasPixel(vTextureCoord); finalColor = texture(uTexture, vTextureCoord + canvas * 0.0); }";
    const placed = defineFilter("fx.placed", { wgsl, glsl, uniforms: { amount: 1 } });
    const plain = defineFilter("fx.plain2", {
      wgsl: PLAIN,
      glsl: PLAIN_GLSL,
      uniforms: { amount: 1 }
    });

    expect(placed.filter.cache).toBe("placed");
    expect(placed.filter.origin).toEqual({
      name: "keptOrigin",
      type: "vec2<f32>",
      form: "vector",
      size: 2
    });
    expect(placed.filter.uniforms.map(uniform => uniform.name)).toEqual(["amount"]);
    expect(placed.filter.source).toContain("keptOrigin: vec2<f32>,");
    expect(placed.filter.source).toContain(
      "fn canvasPixel(uv: vec2<f32>) -> vec2<f32> {\n  return gfu.uOutputFrame.xy + fu.keptOrigin + uv * gfu.uInputSize.xy;\n}"
    );
    expect(placed.filter.glsl).toContain("uniform vec2 keptOrigin;");
    expect(placed.filter.glsl).toContain(
      "vec2 canvasPixel(vec2 uv) {\n  return uOutputFrame.xy + keptOrigin + uv * uInputSize.xy;\n}"
    );
    // The helper precedes the body, which calls it.
    expect(placed.filter.source.indexOf("fn canvasPixel")).toBeLessThan(
      placed.filter.source.indexOf(wgsl)
    );
    expect(plain.filter.origin).toBeUndefined();
    expect(plain.filter.source).toBe(assemble(plain.filter.uniforms, [], PLAIN));
    expect(plain.filter.glsl).toBe(assembleGlsl(plain.filter.uniforms, [], PLAIN_GLSL));
    expect(plain.filter.source).not.toContain("keptOrigin");
  });

  it("the option decides: false is screen, placed is placed, local stays local; a screen read with a declaration is honoured and still warned of", () => {
    const off = defineFilter("fx.off", { wgsl: PLAIN, glsl: PLAIN_GLSL, cache: false });
    const placed = defineFilter("fx.placed2", { wgsl: PLAIN, glsl: PLAIN_GLSL, cache: "placed" });
    const declared = defineFilter("fx.declared", {
      wgsl: wgslReading("gfu.uGlobalFrame.xy"),
      glsl: PLAIN_GLSL,
      cache: "local"
    });
    const quiet = defineFilter("fx.quiet", {
      wgsl: wgslReading("gfu.uGlobalFrame.xy"),
      glsl: PLAIN_GLSL,
      cache: false
    });

    expect([off.filter.cache, placed.filter.cache, declared.filter.cache]).toEqual([
      "screen",
      "placed",
      "local"
    ]);
    expect(readsScreen(declared.filter)).toBe(true);
    expect(readsScreen(quiet.filter)).toBe(false);
  });

  it("a filter with inputs takes the worst category of its stages", () => {
    const Copy = defineFilter("fx.copy", { wgsl: PLAIN, glsl: PLAIN_GLSL });
    const Noisy = defineFilter("fx.noisy", { wgsl: PLAIN, glsl: PLAIN_GLSL, cache: false });
    const chain = (): readonly FilterStep[] => [{ stage: Copy, scale: 0.5 }];
    const reads = (
      name: string,
      stages: NonNullable<Parameters<typeof defineFilter>[1]["inputs"]>
    ) =>
      defineFilter(name, {
        wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return sampleSoft(uv); }",
        glsl: "void main() { finalColor = sampleSoft(vTextureCoord); }",
        inputs: stages
      });

    expect(reads("fx.soft", { soft: { stages: [Copy], chain } }).filter.cache).toBe("local");
    expect(reads("fx.soft2", { soft: { stages: [Copy, Noisy], chain } }).filter.cache).toBe(
      "screen"
    );
  });

  it("keptOrigin and canvasPixel are reserved names, and a cache of no known form is refused", () => {
    for (const name of ["keptOrigin", "canvasPixel"]) {
      expect(() =>
        defineFilter("fx.reserved", { wgsl: PLAIN, glsl: PLAIN_GLSL, uniforms: { [name]: 1 } })
      ).toThrow(`[game] Filter "fx.reserved": uniform "${name}" is reserved.\n  Rename it.`);
    }

    expect(() =>
      defineFilter("fx.true", {
        wgsl: PLAIN,
        glsl: PLAIN_GLSL,
        cache: true as unknown as false
      })
    ).toThrow('[game] Filter "fx.true": cache must be "local", "placed" or false.\n  Got true.');
  });

  it("the engine's Glow and Outline are kept anywhere", () => {
    expect([Glow.filter.cache, Outline.filter.cache]).toEqual(["local", "local"]);
  });
});
