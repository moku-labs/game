/**
 * @file effects/filters — the fragment body of `Outline`: the source drawn over a hard ring of `thickness` CSS px in
 * `color × alpha`, the largest alpha of 12 probes on that ring, over the place helpers of the effect set's head.
 */

/**
 * The WGSL fragment body of `Outline`. Reads `fu.thickness`, `fu.color`, `fu.alpha`. The probes stand on a ring of
 * `thickness` CSS px around the pixel: `thickness / inputFrame()` is that radius in 0..1 of the padded frame, as
 * `Aura`'s ring, so the line is as wide as the padding at any resolution. The ring is hard: the largest alpha of the
 * 12 probes, not their mean. The line is drawn in `color` under the source.
 */
export const OUTLINE_WGSL = /* wgsl */ `const OUTLINE_TAU: f32 = 6.283185307179586;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let c = sampleInput(n);
  let reach = fu.thickness / inputFrame();
  var ring = 0.0;

  for (var i = 0; i < 12; i++) {
    let turn = OUTLINE_TAU * f32(i) / 12.0;
    ring = max(ring, sampleInput(n + vec2<f32>(cos(turn), sin(turn)) * reach).a);
  }

  let line = ring * fu.alpha;

  return c + vec4<f32>(fu.color * line, line) * (1.0 - c.a);
}
`;
