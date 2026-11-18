/**
 * @file effects/set — the set head: the WGSL and GLSL the engine's effect set puts before every member's body. Four
 * helpers: `inputPlace(uv)`, where the pixel is in its input frame (0..1 on each axis, the padded frame Pixi hands the
 * filter), and `sampleInput(n)`, the input read at such a place, inside the clamp; `inputFrame()`, the size of that
 * frame in CSS px, for a padded member that maps its content box; and `setHash(cell)`, the integer hash of `Dissolve`.
 * They read the input's own uniforms (`uInputClamp`, `uInputPixel`, `uInputSize`), never the screen, so a member stays
 * `"local"`; and the clamp is half a texel in from the frame in a live pass and from the whole picture on the quad of
 * stage 2 (`shade.ts`), so one body draws the same in both. The first three are the place part, which the built-in
 * `Outline` draws on too (`withPlaceWgsl`); the hash is the members' alone. A game's body does not get them. Pure
 * strings.
 */

/**
 * The place part of the WGSL head: `inputPlace(uv)` and `sampleInput(n)` over the filter's input, and `inputFrame()`.
 * `textureSampleLevel`, so a member may read its input inside a branch. `inputFrame()` is the clamp's span plus one
 * texel, times the texture's CSS size: live the frame is a share of a pooled texture and `uInputSize` is the texture's,
 * on the quad the frame is the whole picture; both give the frame. The built-in `Outline` draws on it alone
 * (`withPlaceWgsl`), so every game that composes `effectsPlugin` carries these three and no hash.
 */
export const PLACE_WGSL = /* wgsl */ `fn inputPlace(uv: vec2<f32>) -> vec2<f32> {
  return (uv - gfu.uInputClamp.xy) / (gfu.uInputClamp.zw - gfu.uInputClamp.xy);
}

fn sampleInput(n: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(uTexture, uSampler, mix(gfu.uInputClamp.xy, gfu.uInputClamp.zw, clamp(n, vec2<f32>(0.0), vec2<f32>(1.0))), 0.0);
}

fn inputFrame() -> vec2<f32> {
  return (gfu.uInputClamp.zw - gfu.uInputClamp.xy + gfu.uInputPixel.zw) * gfu.uInputSize.xy;
}

`;

/**
 * The hash part of the WGSL head: `setHash(cell)`, a 32-bit integer hash of a cell, 0 up to 1 (24 bits). Integers wrap
 * the same on every GPU, so WebGL and WebGPU dissolve the same cells.
 */
const HASH_WGSL = /* wgsl */ `fn setHash(cell: vec2<f32>) -> f32 {
  let q = vec2<u32>(vec2<i32>(cell));
  var h = (q.x * 1597334677u) ^ (q.y * 3812015801u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = h ^ (h >> 13u);
  return f32(h >> 8u) / 16777216.0;
}

`;

/** The GLSL twin of `PLACE_WGSL`, over `uInputClamp`, `uInputPixel`, `uInputSize` and `uTexture` of the GLSL header. */
export const PLACE_GLSL = /* glsl */ `vec2 inputPlace(vec2 uv) {
  return (uv - uInputClamp.xy) / (uInputClamp.zw - uInputClamp.xy);
}

vec4 sampleInput(vec2 n) {
  return textureLod(uTexture, mix(uInputClamp.xy, uInputClamp.zw, clamp(n, 0.0, 1.0)), 0.0);
}

vec2 inputFrame() {
  return (uInputClamp.zw - uInputClamp.xy + uInputPixel.zw) * uInputSize.xy;
}

`;

/**
 * The GLSL twin of `HASH_WGSL`. The hash's integers are `highp`: the default of a fragment stage is `mediump`, 16 bits
 * on a phone.
 */
const HASH_GLSL = /* glsl */ `float setHash(vec2 cell) {
  highp uvec2 q = uvec2(ivec2(cell));
  highp uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = h ^ (h >> 13u);
  return float(h >> 8u) / 16777216.0;
}

`;

/**
 * A body with the place part of the head before it, and no hash: the built-in `Outline`'s source. A call, so a bundle
 * that drops the body drops the text too: a concatenation at module scope would stay, its strings with it.
 *
 * @param body - The WGSL body.
 * @returns The place helpers, then the body.
 * @example
 * ```ts
 * withPlaceWgsl("@fragment fn mainFragment").includes("fn setHash("); // false
 * ```
 */
export function withPlaceWgsl(body: string): string {
  return PLACE_WGSL + body;
}

/**
 * The GLSL twin of `withPlaceWgsl`.
 *
 * @param body - The GLSL body.
 * @returns The place helpers, then the body.
 * @example
 * ```ts
 * withPlaceGlsl("void main() {}").startsWith("vec2 inputPlace("); // true
 * ```
 */
export function withPlaceGlsl(body: string): string {
  return PLACE_GLSL + body;
}

/**
 * The WGSL head of every member: the place part, then the hash part, `inputPlace(uv)`, `sampleInput(n)`,
 * `inputFrame()` and `setHash(cell)`. Made by a call, so a game that lists no member carries neither part's hash.
 */
export const SET_WGSL = /*#__PURE__*/ withPlaceWgsl(HASH_WGSL);

/** The GLSL twin of `SET_WGSL`: the same four helpers. */
export const SET_GLSL = /*#__PURE__*/ withPlaceGlsl(HASH_GLSL);

/**
 * A member's WGSL body with the set head before it. A call, so a bundle that drops the member drops the text too: a
 * concatenation at module scope would stay, its strings with it.
 *
 * @param body - The member's WGSL body.
 * @returns The head, then the body.
 * @example
 * ```ts
 * withSetWgsl("@fragment fn mainFragment").startsWith("fn inputPlace("); // true
 * ```
 */
export function withSetWgsl(body: string): string {
  return SET_WGSL + body;
}

/**
 * A member's GLSL body with the set head before it, for the same reason as `withSetWgsl`.
 *
 * @param body - The member's GLSL body.
 * @returns The head, then the body.
 * @example
 * ```ts
 * withSetGlsl("void main() {}").startsWith("vec2 inputPlace("); // true
 * ```
 */
export function withSetGlsl(body: string): string {
  return SET_GLSL + body;
}
