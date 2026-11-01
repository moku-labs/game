import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { defineFilter } from "../../filters/define";
import type { UniformSpec } from "../../filters/types";
import { assembleQuad, HEADER } from "../../filters/wgsl";
import { Frosted, Soft, Under } from "../filter-fixtures";

// ---------------------------------------------------------------------------
// Unit test: the quad program (F126 stage 2), the WGSL that runs a filter's own
// fragment body on a mesh in the pass that draws the canvas: Pixi's two groups,
// the filter's moved to 2 and 3, the body renamed `filterBody`. What the rewrite
// cannot carry stays undefined, and the source a filter draws with today does
// not move by one byte.
// ---------------------------------------------------------------------------

/** The plain signature, as most bodies write it. */
const SIGNATURE = "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32>";

/** What the rewrite makes of it. */
const REWRITTEN = "fn filterBody(uv: vec2<f32>) -> vec4<f32>";

/** A helper, the plain signature and a body that reads a uniform. */
const BODY = `fn dim(color: vec4<f32>) -> vec4<f32> {
  return color * fu.amount;
}

${SIGNATURE} {
  return dim(textureSample(uTexture, uSampler, uv));
}
`;

/** The GLSL twin every filter of this file carries: the check of the twin is not what is tested. */
const GLSL = "void main() { finalColor = texture(uTexture, vTextureCoord) * amount; }";

/** One number uniform. */
const AMOUNT: UniformSpec = { name: "amount", type: "f32", form: "number", size: 1 };

/** The engine's uniform of a body that calls `canvasPixel`. */
const ORIGIN: UniformSpec = { name: "keptOrigin", type: "vec2<f32>", form: "vector", size: 2 };

/**
 * Every binding of a WGSL source, as written.
 *
 * @param source - The source.
 * @returns `"group binding name"` per declaration, in source order.
 */
function bindings(source: string): string[] {
  return [...source.matchAll(/@group\((\d)\) @binding\((\d)\) var(?:<uniform>)? (\w+)/g)].map(
    match => `${match[1]} ${match[2]} ${match[3]}`
  );
}

/**
 * A short digest of a text: an exact pin of a long source.
 *
 * @param text - The text.
 * @returns Its first 16 hex digits of sha-256.
 */
function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

describe("assembleQuad", () => {
  // Bug: a group left at 1 fails the pipeline layout, on the phone only.
  it("binds Pixi's groups 0 and 1, the filter's at 2 and 3, each binding once", () => {
    expect(bindings(assembleQuad([AMOUNT], BODY) ?? "")).toEqual([
      "2 0 gfu",
      "2 1 uTexture",
      "2 2 uSampler",
      "0 0 globalUniforms",
      "1 0 localUniforms",
      "3 0 fu"
    ]);
  });

  // Bug: an unused group 3 that a filter without uniforms has no group for: the shader cannot bind it.
  it("declares no group 3 for a body without uniforms", () => {
    expect(bindings(assembleQuad([], BODY) ?? "")).toEqual([
      "2 0 gfu",
      "2 1 uTexture",
      "2 2 uSampler",
      "0 0 globalUniforms",
      "1 0 localUniforms"
    ]);
  });

  // Bug: the mesh draws the body without the view's alpha: a double fade, or none.
  it("calls the body from mainFragment times the mesh's colour and alpha, and leaves its text alone", () => {
    const source = assembleQuad([AMOUNT], BODY) ?? "";

    expect(source).toContain(BODY.replace(SIGNATURE, REWRITTEN));
    expect(source).toContain(
      "return filterBody(uv) * localUniforms.uColor * globalUniforms.uWorldColorAlpha;"
    );
    expect(source.match(/@fragment/g)).toHaveLength(1);
    expect(source.match(/@vertex/g)).toHaveLength(1);
  });

  // Bug: the quad's struct drifts from the one Pixi fills live: a body reads another member on the mesh.
  it("holds the global filter uniforms of the live header, member for member", () => {
    const struct = HEADER.slice(0, HEADER.indexOf("@group"));

    expect(assembleQuad([], BODY)).toContain(struct);
  });

  // Bug: a body that calls `canvasPixel` does not compile on the mesh and silently stays on stage 3.
  it("carries `canvasPixel` and the origin only for a body that has one", () => {
    const placed = assembleQuad([AMOUNT], BODY, ORIGIN) ?? "";

    expect(placed).toContain("fn canvasPixel(uv: vec2<f32>) -> vec2<f32>");
    expect(placed).toContain("keptOrigin: vec2<f32>");
    expect(assembleQuad([AMOUNT], BODY)).not.toContain("canvasPixel");
  });
});

describe("the bodies the rewrite takes", () => {
  // Bug: a body that cannot be called from the wrapper reaches the GPU.
  it.each([
    [
      "@builtin(position) in a helper's struct",
      `struct In { @builtin(position) at: vec4<f32> };\n${SIGNATURE} { return vec4<f32>(0.0); }`
    ],
    [
      "a second parameter",
      "@fragment fn mainFragment(@location(0) uv: vec2<f32>, @builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> { return vec4<f32>(uv, at.xy); }"
    ],
    ["another parameter type", SIGNATURE.replace("vec2<f32>", "vec3<f32>")],
    ["a body declaring filterBody", `fn filterBody() {}\n${SIGNATURE} { return vec4<f32>(0.0); }`],
    [
      "a body declaring localUniforms",
      `var<private> localUniforms: f32;\n${SIGNATURE} { return vec4<f32>(0.0); }`
    ],
    ["a body with its own LocalUniforms", `struct LocalUniforms { a: f32 };\n${SIGNATURE} { }`],
    ["two entry points", `${SIGNATURE} { }\n${SIGNATURE} { }`]
  ])("refuses %s", (_name, body) => {
    expect(assembleQuad([], body)).toBeUndefined();
  });

  it("takes a commented-out @builtin", () => {
    const body = `// @builtin(position) was read here\n/* @builtin(front_facing) */\n${SIGNATURE} { return vec4<f32>(0.0); }`;

    expect(assembleQuad([], body)).toContain(REWRITTEN);
  });

  // The effects README writes `@fragment` on its own line, and so do the built-ins.
  it("takes @fragment on its own line and keeps the body's name for the uv", () => {
    const body = `
@fragment
fn mainFragment(
  @location(0) texCoord : vec2<f32>
) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, texCoord);
}`;
    const source = assembleQuad([], body);

    expect(source).toContain("fn filterBody(texCoord: vec2<f32>) -> vec4<f32>");
    expect(source).toContain("return textureSample(uTexture, uSampler, texCoord);");
  });

  // Bug: the rewrite lands in the comment that quotes the signature, and the real entry point clashes with the wrapper.
  it("rewrites the signature, not a comment that quotes it", () => {
    const quoted = `// was: ${SIGNATURE}`;
    const source = assembleQuad([], `${quoted}\n${SIGNATURE} { return vec4<f32>(0.0); }`);

    expect(source).toContain(quoted);
    expect(source).toContain(`${REWRITTEN} { return vec4<f32>(0.0); }`);
  });
});

describe("defineFilter and the quad text", () => {
  // Bug: a body that reads a second texture, or the canvas under it, is moved to a mesh that binds neither.
  it("has quad text for a plain body, none with inputs or for a backdrop", () => {
    const Tint = defineFilter("fixture.quadTint", {
      wgsl: BODY,
      glsl: GLSL,
      uniforms: { amount: 1 }
    });

    expect(Tint.filter.quadSource).toBe(assembleQuad(Tint.filter.uniforms, BODY));
    expect(Soft.filter.quadSource).toBeUndefined();
    expect(Under.filter.quadSource).toBeUndefined();
    expect(Frosted.filter.quadSource).toBeUndefined();
  });
});

describe("the source a filter draws with today", () => {
  // Bug: the group parameter moves `fu` of a live filter, at any byte of any shape. The digests were read before the
  // quad existed.
  it.each([
    [
      "a body without uniforms",
      defineFilter("fixture.pinNone", { wgsl: BODY, glsl: GLSL }).filter.source,
      "0c1108af15bba94f"
    ],
    [
      "a body with uniforms",
      defineFilter("fixture.pinSome", {
        wgsl: BODY,
        glsl: GLSL,
        uniforms: { amount: 1, color: { color: 0xff_00_00 }, at: [0, 0] }
      }).filter.source,
      "42d52edb737944d0"
    ],
    [
      "a body that calls canvasPixel",
      defineFilter("fixture.pinPlaced", {
        wgsl: `${BODY}\nfn at(uv: vec2<f32>) -> vec2<f32> { return canvasPixel(uv); }`,
        glsl: GLSL,
        uniforms: { amount: 1 }
      }).filter.source,
      "3e57d839b604d519"
    ],
    ["a body with an input", Soft.filter.source, "a46694a8596c61b9"],
    ["a backdrop", Under.filter.source, "3c70dacd5b549e7d"],
    ["a backdrop with an input", Frosted.filter.source, "58b51ccd131d12b8"]
  ])("does not move for %s", (_name, source, pinned) => {
    expect(digest(source)).toBe(pinned);
  });
});
