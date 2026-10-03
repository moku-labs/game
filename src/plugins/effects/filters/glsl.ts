/**
 * @file effects/filters — the GLSL the engine writes around a fragment body, the WebGL twin of
 * `wgsl.ts`: the version and the precision, the inputs and the output Pixi's WebGL filter system
 * fills, and one `uniform` per declared uniform under its bare name. Pixi binds a `UniformGroup`
 * on WebGL by uniform name, so the one group of an instance serves both programs and the shader
 * cannot drift from it. Pure strings.
 */
import type { UniformSpec } from "./types";

/**
 * The head of every filter's GLSL. `#version 300 es` comes first, so Pixi compiles both stages
 * as GLSL ES 3.0 and the dev check compiles the same text; `highp` matches the `f32` of the WGSL
 * twin and the precision of the uniforms the vertex stage shares. Then the texture coordinate of
 * `defaultFilterVert`, the output, the input texture and the global filter uniforms as `vec4`.
 */
export const GLSL_HEADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputPixel;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform vec4 uGlobalFrame;
uniform vec4 uOutputTexture;

`;

/** The GLSL type of each uniform type: a number is a `float`, a colour or a tuple a vector. */
const GLSL_TYPES: Readonly<Record<UniformSpec["type"], string>> = {
  f32: "float",
  "vec2<f32>": "vec2",
  "vec3<f32>": "vec3",
  "vec4<f32>": "vec4"
};

/**
 * One `uniform` line per uniform, in declaration order, under the bare names the group keys.
 * Nothing without uniforms.
 *
 * @param uniforms - The uniforms in declaration order.
 * @returns The GLSL lines, or `""`.
 * @example
 * ```ts
 * glslUniforms([{ name: "color", type: "vec3<f32>", form: "color", size: 3 }]); // "uniform vec3 color;\n\n"
 * ```
 */
export function glslUniforms(uniforms: readonly UniformSpec[]): string {
  if (uniforms.length === 0) return "";

  const lines = uniforms.map(uniform => `uniform ${GLSL_TYPES[uniform.type]} ${uniform.name};\n`);

  return `${lines.join("")}\n`;
}

/**
 * The whole GLSL of a filter: the header, the uniforms, the body.
 *
 * @param uniforms - The uniforms in declaration order.
 * @param body - The fragment body the game wrote.
 * @returns The GLSL fragment source the `GlProgram` is built from.
 * @example
 * ```ts
 * assembleGlsl([], body).endsWith(body); // true
 * ```
 */
export function assembleGlsl(uniforms: readonly UniformSpec[], body: string): string {
  return `${GLSL_HEADER}${glslUniforms(uniforms)}${body}`;
}
