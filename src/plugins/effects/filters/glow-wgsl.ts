/**
 * @file effects/filters — the fragment body of `Glow`: for 12 directions, 4 samples out to
 * `distance` pixels keep the largest alpha found; the halo is `color × alpha × strength` under the
 * source pixel, the source drawn over it.
 */

/**
 * The WGSL fragment body of `Glow`. Reads `fu.strength`, `fu.distance`, `fu.color`, `fu.alpha`.
 */
export const GLOW_WGSL = /* wgsl */ `const GLOW_SPOKES: i32 = 12;
const GLOW_STEPS: i32 = 4;
const GLOW_TAU: f32 = 6.283185307179586;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let source = textureSample(uTexture, uSampler, uv);
  let texel = gfu.uInputSize.zw;
  var found = 0.0;

  for (var spoke = 0; spoke < GLOW_SPOKES; spoke++) {
    let turn = GLOW_TAU * f32(spoke) / f32(GLOW_SPOKES);
    let reach = vec2<f32>(cos(turn), sin(turn)) * texel * fu.distance;

    for (var ring = 1; ring <= GLOW_STEPS; ring++) {
      let probe = clamp(uv + reach * f32(ring) / f32(GLOW_STEPS), gfu.uInputClamp.xy, gfu.uInputClamp.zw);

      found = max(found, textureSample(uTexture, uSampler, probe).a);
    }
  }

  let halo = clamp(found * fu.alpha * fu.strength, 0.0, 1.0);

  return source + vec4<f32>(fu.color * halo, halo) * (1.0 - source.a);
}
`;
