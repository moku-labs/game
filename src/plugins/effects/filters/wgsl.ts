/**
 * @file effects/filters — the WGSL the engine writes around a fragment body: the inputs Pixi's
 * filter system fills, the vertex stage, and the uniform struct generated from the declaration,
 * so the shader and the uniform layout cannot drift. For each input the engine declares the texture,
 * its sampler (WGSL only), its scale and clamp uniforms and `sample<Name>(uv)`. Pure strings.
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
 * The whole source of a filter: the header, the uniform struct (the uniforms, then the scale and the clamp of each
 * input, then the engine's `keptOrigin` of a body that calls `canvasPixel`), the input bindings, the helper, the
 * body. A body without the helper assembles byte-identically to one without the cache.
 *
 * @param uniforms - The uniforms in declaration order.
 * @param inputs - The inputs in declaration order.
 * @param body - The fragment body the game wrote.
 * @param origin - The `keptOrigin` uniform, for a body that calls `canvasPixel`.
 * @returns The WGSL source both stages are built from.
 * @example
 * ```ts
 * assemble([], [], body).endsWith(body); // true
 * ```
 */
export function assemble(
  uniforms: readonly UniformSpec[],
  inputs: readonly FilterInputDefinition[],
  body: string,
  origin?: UniformSpec
): string {
  const struct = uniformStruct([
    ...uniforms,
    ...inputs.flatMap(input => [input.scale, input.clamp]),
    ...(origin === undefined ? [] : [origin])
  ]);
  const helper = origin === undefined ? "" : CANVAS_PIXEL;

  return `${HEADER}${struct}${inputBindings(inputs)}${helper}${body}`;
}
