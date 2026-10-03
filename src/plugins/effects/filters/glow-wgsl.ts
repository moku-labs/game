/**
 * @file effects/filters — the fragment body of `Glow`: a soft halo that follows the shape. 64
 * probes spread evenly over the disc of radius `distance` around the pixel (a golden-angle
 * spiral, so no rings and no spokes show) measure how much of the disc the shape covers: about ½
 * next to a straight edge, falling to 0 at `distance`. The halo is
 * `color × coverage × strength × alpha`, premultiplied, under the source pixel, the source drawn
 * over it. Every probe stays in the input frame, so the padding around the view stays clear.
 */

/**
 * The WGSL fragment body of `Glow`. Reads `fu.strength`, `fu.distance`, `fu.color`, `fu.alpha`.
 */
export const GLOW_WGSL = /* wgsl */ `const GLOW_PROBES: i32 = 64;
const GLOW_TURN_COS: f32 = -0.7373688780783197;
const GLOW_TURN_SIN: f32 = 0.6754902942615238;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let source = textureSample(uTexture, uSampler, uv);
  let reach = gfu.uInputSize.zw * fu.distance;
  var turn = vec2<f32>(1.0, 0.0);
  var coverage = 0.0;

  for (var probeIndex = 0; probeIndex < GLOW_PROBES; probeIndex++) {
    let along = sqrt((f32(probeIndex) + 0.5) / f32(GLOW_PROBES));
    let probe = clamp(uv + turn * reach * along, gfu.uInputClamp.xy, gfu.uInputClamp.zw);

    coverage += textureSample(uTexture, uSampler, probe).a;
    turn = vec2<f32>(
      turn.x * GLOW_TURN_COS - turn.y * GLOW_TURN_SIN,
      turn.x * GLOW_TURN_SIN + turn.y * GLOW_TURN_COS
    );
  }

  coverage /= f32(GLOW_PROBES);

  let halo = clamp(coverage * fu.strength * fu.alpha, 0.0, 1.0) * (1.0 - source.a);

  return source + vec4<f32>(fu.color * halo, halo);
}
`;
