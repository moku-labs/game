/**
 * @file effects/set — the set head: the WGSL and GLSL the engine's effect set puts before every member's body. Two
 * helpers: `inputPlace(uv)`, where the pixel is in its input frame (0..1 on each axis, the padded frame Pixi hands the
 * filter), and `sampleInput(n)`, the input read at such a place, inside the clamp. Both read `uInputClamp` only, never
 * the screen, so a member stays `"local"`; and the clamp is half a texel in from the frame in a live pass and from the
 * whole picture on the quad of stage 2 (`shade.ts`), so one body draws the same in both. A game's body does not get
 * them. Pure strings.
 */

/**
 * The WGSL head of every member: `inputPlace(uv)` and `sampleInput(n)` over the filter's input. `textureSampleLevel`,
 * so a member may read its input inside a branch.
 */
export const SET_WGSL = /* wgsl */ `fn inputPlace(uv: vec2<f32>) -> vec2<f32> {
  return (uv - gfu.uInputClamp.xy) / (gfu.uInputClamp.zw - gfu.uInputClamp.xy);
}

fn sampleInput(n: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(uTexture, uSampler, mix(gfu.uInputClamp.xy, gfu.uInputClamp.zw, clamp(n, vec2<f32>(0.0), vec2<f32>(1.0))), 0.0);
}

`;

/** The GLSL twin of `SET_WGSL`: the same two helpers over `uInputClamp` and `uTexture` of the GLSL header. */
export const SET_GLSL = /* glsl */ `vec2 inputPlace(vec2 uv) {
  return (uv - uInputClamp.xy) / (uInputClamp.zw - uInputClamp.xy);
}

vec4 sampleInput(vec2 n) {
  return textureLod(uTexture, mix(uInputClamp.xy, uInputClamp.zw, clamp(n, 0.0, 1.0)), 0.0);
}

`;
