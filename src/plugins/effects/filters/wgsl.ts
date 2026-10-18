/**
 * @file effects/filters — the WGSL the engine writes around a fragment body: the inputs Pixi's
 * filter system fills, the vertex stage, and the uniform struct generated from the declaration,
 * so the shader and the uniform layout cannot drift. For each input the engine declares the texture,
 * its sampler (WGSL only), its scale and clamp uniforms and `sample<Name>(uv)`; for a backdrop, the
 * texture Pixi copies the canvas under the view into (`uBackTexture`, group 0 binding 3), its scale
 * and clamp uniforms and `sampleBack(uv)`. Pure strings.
 */
import type { FilterInputDefinition, UniformSpec } from "./types";

/**
 * The head of every filter shader: the global filter uniforms and the input texture and sampler
 * in `@group(0)` bindings 0 to 2, under the names Pixi's `FilterSystem` fills; then the vertex
 * stage that maps the filter quad to its output frame and hands the fragment its `uv`.
 */
export const HEADER = /* wgsl */ `struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  var clip = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;

  clip.x = clip.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  clip.y = clip.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;

  return VSOutput(vec4<f32>(clip, 0.0, 1.0), aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw));
}

`;

/**
 * The uniform struct of a filter in declaration order and its `fu` binding in `@group(1)`; the
 * resource key of the instance is `fu` too. Nothing without uniforms.
 *
 * @param uniforms - The uniforms in declaration order.
 * @returns The WGSL lines, or `""`.
 * @example
 * ```ts
 * uniformStruct([{ name: "amount", type: "f32", form: "number", size: 1 }]); // "struct FilterUniforms {\n  amount: f32,\n};\n\n@group(1) @binding(0) var<uniform> fu: FilterUniforms;\n"
 * ```
 */
export function uniformStruct(uniforms: readonly UniformSpec[]): string {
  if (uniforms.length === 0) return "";

  const fields = uniforms.map(uniform => `  ${uniform.name}: ${uniform.type},\n`).join("");

  return (
    `struct FilterUniforms {\n${fields}};\n\n` +
    "@group(1) @binding(0) var<uniform> fu: FilterUniforms;\n"
  );
}

/**
 * The engine's half of each input: the texture and the sampler in `@group(1)` after `fu`, and the function that
 * reads the input at the body's uv, its scale and its clamp applied. Nothing without inputs.
 *
 * @param inputs - The inputs in declaration order.
 * @returns The WGSL lines, or `""`.
 * @example
 * ```ts
 * inputBindings([blurInput]).includes("fn sampleBlur(uv: vec2<f32>) -> vec4<f32>"); // true
 * ```
 */
export function inputBindings(inputs: readonly FilterInputDefinition[]): string {
  return inputs
    .map(
      (input, index) =>
        `@group(1) @binding(${1 + 2 * index}) var ${input.texture}: texture_2d<f32>;\n` +
        `@group(1) @binding(${2 + 2 * index}) var ${input.sampler}: sampler;\n\n` +
        `fn ${input.sample}(uv: vec2<f32>) -> vec4<f32> {\n` +
        `  return textureSampleLevel(${input.texture}, ${input.sampler}, clamp(uv * gfu.uInputSize.xy * fu.${input.scale.name}, fu.${input.clamp.name}.xy, fu.${input.clamp.name}.zw), 0.0);\n` +
        "}\n\n"
    )
    .join("");
}

/**
 * The helper a body that needs its canvas position calls (spec 23 P8.3): the pixel's canvas position in CSS px. Drawn
 * live `keptOrigin` is `(0, 0)`; inside a kept picture the renderer writes the picture's canvas origin there, so the
 * answer is the same.
 */
export const CANVAS_PIXEL = /* wgsl */ `fn canvasPixel(uv: vec2<f32>) -> vec2<f32> {
  return gfu.uOutputFrame.xy + fu.keptOrigin + uv * gfu.uInputSize.xy;
}

`;

/**
 * The engine's uniform a backdrop's `sampleBack` scales its uv by: one over the size of the back texture's backing,
 * CSS px. Filled by every apply from the texture Pixi copied.
 */
export const BACK_SCALE: UniformSpec = Object.freeze({
  name: "backScale",
  type: "vec2<f32>",
  form: "vector",
  size: 2
});

/** The engine's uniform a backdrop's `sampleBack` clamps to: half a texel inside the copied part of the back texture. */
export const BACK_CLAMP: UniformSpec = Object.freeze({
  name: "backClamp",
  type: "vec4<f32>",
  form: "vector",
  size: 4
});

/**
 * What a backdrop's body reads what was drawn under its view through: the texture Pixi's filter system copies the
 * canvas into and binds at group 0 binding 3 (`Filter.blendRequired`), sampled at the body's uv with the engine's
 * scale and clamp, as an input is.
 */
export const SAMPLE_BACK = /* wgsl */ `@group(0) @binding(3) var uBackTexture: texture_2d<f32>;

fn sampleBack(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(uBackTexture, uSampler, clamp(uv * gfu.uInputSize.xy * fu.backScale, fu.backClamp.xy, fu.backClamp.zw), 0.0);
}

`;

/**
 * The whole source of a filter: the header, the uniform struct (the uniforms, then the scale and the clamp of each
 * input, then a backdrop's back scale and clamp, then the engine's `keptOrigin` of a body that calls `canvasPixel`),
 * the input bindings, a backdrop's `sampleBack`, the `canvasPixel` helper, the body. A body without either helper
 * assembles byte-identically to one without the cache and without the backdrop.
 *
 * @param uniforms - The uniforms in declaration order.
 * @param inputs - The inputs in declaration order.
 * @param body - The fragment body the game wrote.
 * @param origin - The `keptOrigin` uniform, for a body that calls `canvasPixel`.
 * @param backdrop - True for a filter that reads what was drawn under its view.
 * @returns The WGSL source both stages are built from.
 * @example
 * ```ts
 * assemble([], [], body, undefined, true).includes("fn sampleBack(uv: vec2<f32>) -> vec4<f32>"); // true
 * ```
 */
export function assemble(
  uniforms: readonly UniformSpec[],
  inputs: readonly FilterInputDefinition[],
  body: string,
  origin?: UniformSpec,
  backdrop = false
): string {
  const struct = uniformStruct([
    ...uniforms,
    ...inputs.flatMap(input => [input.scale, input.clamp]),
    ...(backdrop ? [BACK_SCALE, BACK_CLAMP] : []),
    ...(origin === undefined ? [] : [origin])
  ]);
  const back = backdrop ? SAMPLE_BACK : "";
  const helper = origin === undefined ? "" : CANVAS_PIXEL;

  return `${HEADER}${struct}${inputBindings(inputs)}${back}${helper}${body}`;
}
