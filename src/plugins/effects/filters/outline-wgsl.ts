/**
 * @file effects/filters — the fragment body of `Outline`: the source drawn over a ring of
 * `thickness` pixels in `color × alpha`, sampled in 8 directions, 12 from 6 px, as the `text`
 * outline does.
 */

/**
 * The WGSL fragment body of `Outline`. Reads `fu.thickness`, `fu.color`, `fu.alpha`.
 */
export const OUTLINE_WGSL = /* wgsl */ `const OUTLINE_TAU: f32 = 6.283185307179586;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let source = textureSample(uTexture, uSampler, uv);
  let texel = gfu.uInputSize.zw;
  let spokes = select(8, 12, fu.thickness >= 6.0);
  var edge = 0.0;

  for (var spoke = 0; spoke < spokes; spoke++) {
    let turn = OUTLINE_TAU * f32(spoke) / f32(spokes);
    let probe = clamp(
      uv + vec2<f32>(cos(turn), sin(turn)) * texel * fu.thickness,
      gfu.uInputClamp.xy,
      gfu.uInputClamp.zw
    );

    edge = max(edge, textureSample(uTexture, uSampler, probe).a);
  }

  let line = edge * fu.alpha;

  return source + vec4<f32>(fu.color * line, line) * (1.0 - source.a);
}
`;
