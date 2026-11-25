import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { defineFilter } from "../../filters/define";
import type { UniformSpec } from "../../filters/types";
import { assemble, assembleQuad, HEADER } from "../../filters/wgsl";
import {
  Frosted,
  SOFT_BODIES,
  SOFT_STAGES,
  Soft,
  softChain,
  UNDER_BODIES,
  Under
} from "../filter-fixtures";

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

  // Bug: the inputs parameter moves the quad of a filter without inputs, which drew right before it existed. The
  // digests were read before the parameter existed.
  it.each([
    ["uniforms", [AMOUNT], undefined, "e86797dcae06ecae"],
    ["uniforms and the origin", [AMOUNT], ORIGIN, "0bbea875d3070b21"],
    ["no uniforms", [], undefined, "1b5c6ca0f265b108"]
  ] as const)("does not move with no inputs, for a body with %s", (_name, uniforms, origin, pinned) => {
    expect(digest(assembleQuad(uniforms, BODY, origin, []) ?? "")).toBe(pinned);
  });
});

describe("assembleQuad with inputs", () => {
  /** `Soft`'s one input, `soft`: what the engine declares for it. */
  const inputs = Soft.filter.inputs;

  // Bug: a struct that does not match the instance's group member for member: a blank view, and only an asynchronous
  // GPU validation error.
  it("lists the uniforms, then each input's scale and clamp, then the origin", () => {
    const source = assembleQuad([AMOUNT], BODY, ORIGIN, inputs) ?? "";

    expect(source).toContain(
      "struct FilterUniforms {\n  amount: f32,\n  softScale: vec2<f32>,\n  softClamp: vec4<f32>,\n  keptOrigin: vec2<f32>,\n};"
    );
  });

  // Bug: an input bound at group 1, Pixi's mesh group, or over `fu`: the pipeline layout fails, on the phone only.
  it("binds each input's texture and sampler at group 3 after fu, and its sample helper once", () => {
    const source = assembleQuad([AMOUNT], BODY, undefined, inputs) ?? "";

    expect(bindings(source).slice(5)).toEqual(["3 0 fu", "3 1 softTexture", "3 2 softSampler"]);
    expect(source.match(/fn sampleSoft\(uv: vec2<f32>\) -> vec4<f32>/g)).toHaveLength(1);
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
  // Bug: a plain body loses its quad, or one with inputs that start from its view stays off it: 3 passes a frame for a
  // value the chain does not read.
  it("has quad text for a plain body and for one whose inputs start from its view", () => {
    const Tint = defineFilter("fixture.quadTint", {
      wgsl: BODY,
      glsl: GLSL,
      uniforms: { amount: 1 }
    });

    expect(Tint.filter.quadSource).toBe(assembleQuad(Tint.filter.uniforms, BODY));
    expect(Soft.filter.quadSource).toBe(
      assembleQuad(Soft.filter.uniforms, SOFT_BODIES.wgsl, undefined, Soft.filter.inputs)
    );
  });

  // Bug: a mesh over a chain of the view under a backdrop, which no Source can feed, gets a quad; a backdrop whose inputs
  // all read back, or that reads none, has one over a Source (F126 stage 5, A2).
  it("has none for a backdrop whose input reads its view, one for a backdrop without inputs or with inputs from back", () => {
    const Misted = defineFilter("fixture.quadMisted", {
      ...SOFT_BODIES,
      uniforms: { spread: 1, tone: 0 },
      backdrop: true,
      inputs: { soft: { stages: SOFT_STAGES, chain: softChain } }
    });

    expect(Misted.filter.inputs[0]?.from).toBe("input");
    expect(Misted.filter.quadSource).toBeUndefined();
    expect(Under.filter.quadSource).toBe(
      assembleQuad(Under.filter.uniforms, UNDER_BODIES.wgsl, undefined, [], true)
    );
    expect(Frosted.filter.quadSource).toBe(
      assembleQuad(
        Frosted.filter.uniforms,
        SOFT_BODIES.wgsl,
        undefined,
        Frosted.filter.inputs,
        true
      )
    );
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
    // A2 (F126 stage 5): a backdrop's struct gains `backOffset`, an input from back its offset; the live apply writes 0.
    ["a backdrop", Under.filter.source, "0a27dbb858b30146"],
    ["a backdrop with an input", Frosted.filter.source, "5a26508d8b3e088a"]
  ])("does not move for %s", (_name, source, pinned) => {
    expect(digest(source)).toBe(pinned);
  });
});

/**
 * The members of the first `struct FilterUniforms` of a text, in order.
 *
 * @param source - A WGSL text.
 * @returns The member lines, trimmed.
 */
function structOf(source: string | undefined): string[] {
  const body = /struct FilterUniforms \{\n([\s\S]*?)\};/.exec(source ?? "")?.[1] ?? "";

  return body
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "");
}

describe("a backdrop over a Source (F126 stage 5)", () => {
  // Bug: the quad's struct differs from the live struct by one member: the instance's one group reads the wrong numbers
  // on the mesh, a silent blank view (A2).
  it("lists the struct of the live text and of the quad text member for member, offsets after each clamp", () => {
    const live = structOf(Frosted.filter.source);

    expect(structOf(Frosted.filter.quadSource)).toEqual(live);
    expect(live).toEqual([
      "spread: f32,",
      "tone: f32,",
      "softScale: vec2<f32>,",
      "softClamp: vec4<f32>,",
      "softOffset: vec2<f32>,",
      "backScale: vec2<f32>,",
      "backClamp: vec4<f32>,",
      "backOffset: vec2<f32>,"
    ]);
    expect(Frosted.filter.glsl).toContain(
      "uniform vec2 softScale;\nuniform vec4 softClamp;\nuniform vec2 softOffset;\nuniform vec2 backScale;\nuniform vec4 backClamp;\nuniform vec2 backOffset;\n"
    );
  });

  // Bug: the quad binds the Source where the input's result goes, or reads the window's place off nothing: the back
  // texture is a plain group-3 binding after the inputs, with its own sampler, and both helpers add their offset.
  it("binds the back after the inputs at group 3 and adds each offset; a filter that is no backdrop has none", () => {
    const quad = Frosted.filter.quadSource ?? "";

    expect(quad).toContain("@group(3) @binding(1) var softTexture: texture_2d<f32>;");
    expect(quad).toContain("@group(3) @binding(3) var uBackTexture: texture_2d<f32>;");
    expect(quad).toContain("@group(3) @binding(4) var uBackSampler: sampler;");
    expect(quad).toContain("uv * gfu.uInputSize.xy * fu.softScale + fu.softOffset");
    expect(quad).toContain(
      "textureSampleLevel(uBackTexture, uBackSampler, clamp(uv * gfu.uInputSize.xy * fu.backScale + fu.backOffset"
    );
    expect(Frosted.filter.source).toContain(
      "textureSampleLevel(uBackTexture, uSampler, clamp(uv * gfu.uInputSize.xy * fu.backScale + fu.backOffset"
    );
    expect(Soft.filter.quadSource).not.toMatch(/uBackTexture|Offset/);
    expect(assemble([], Soft.filter.inputs, SOFT_BODIES.wgsl)).not.toContain("softOffset");
  });

  // Bug: a game uniform takes a name the engine declares for a backdrop: its struct holds the member twice (A2, A12).
  it("refuses backOffset, uBackSampler and an input-from-back's offset as a uniform; a view input's offset stays free", () => {
    const back = (uniforms: Record<string, number>): unknown =>
      defineFilter("fixture.reservedBack", {
        ...SOFT_BODIES,
        uniforms: { spread: 1, tone: 0, ...uniforms },
        backdrop: true,
        inputs: { blur: { from: "back", stages: SOFT_STAGES, chain: softChain } }
      });

    expect(() => back({ backOffset: 0 })).toThrow(/uniform "backOffset" is reserved/);
    expect(() => back({ uBackSampler: 0 })).toThrow(/uniform "uBackSampler" is reserved/);
    expect(() => back({ blurOffset: 0 })).toThrow(
      /makes "blurOffset", which is a uniform of the filter/
    );

    const Free = defineFilter("fixture.freeOffset", {
      ...SOFT_BODIES,
      uniforms: { spread: 1, tone: 0, blurOffset: 0 },
      inputs: { blur: { stages: SOFT_STAGES, chain: softChain } }
    });

    expect(Free.filter.inputs[0]?.offset).toBeUndefined();
    expect(structOf(Free.filter.source)).toContain("blurOffset: f32,");
  });
});
