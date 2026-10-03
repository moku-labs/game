/**
 * @file effects/filters — the fragment body of `Glow`: a soft halo that follows the shape.
 * Probes spread evenly over the disc of radius `distance` around the pixel (a golden-angle
 * spiral, so no rings and no spokes show) measure how much of the disc the shape covers, each
 * probe weighted by `(1 − r / distance)²`: the near probes count most and the rim counts nothing.
 * Next to a straight edge that is about ½, and it falls off fast and then slowly to 0 at
 * `distance`, with no step at the rim, so the halo reads as a glow and not as a flat band (the
 * unweighted mean falls almost linearly and reads as an outline). The halo is
 * `color × coverage × strength × alpha`, premultiplied, under the source pixel, the source drawn
 * over it. Every probe stays in the input frame, so the padding around the view stays clear.
 *
 * 64 to 256 probes, by radius in physical pixels: `clamp(ceil((distance × resolution)² × 0.25),
 * 64, 256)`, about 3.5 physical pixels apart up to a radius of 32 physical pixels, so a glow on a
 * dense screen does not band; past it the 256 spread wider. The count comes from uniforms only,
 * so the loop leaves at it in uniform control flow, under the constant bound 256.
 */

/**
 * The WGSL fragment body of `Glow`. Reads `fu.strength`, `fu.distance`, `fu.color`, `fu.alpha`.
 */
export const GLOW_WGSL = /* wgsl */ `const GLOW_MAX_PROBES: i32 = 256;
const GLOW_TURN_COS: f32 = -0.7373688780783197;
const GLOW_TURN_SIN: f32 = 0.6754902942615238;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let source = textureSample(uTexture, uSampler, uv);
  let reach = gfu.uInputSize.zw * fu.distance;
  let radiusPx = fu.distance * gfu.uInputPixel.x * gfu.uInputSize.z;
  let probes = clamp(i32(ceil(radiusPx * radiusPx * 0.25)), 64, GLOW_MAX_PROBES);
  var turn = vec2<f32>(1.0, 0.0);
  var coverage = 0.0;
  var weights = 0.0;

  for (var probeIndex = 0; probeIndex < GLOW_MAX_PROBES; probeIndex++) {
    if (probeIndex >= probes) { break; }

    let along = sqrt((f32(probeIndex) + 0.5) / f32(probes));
    let weight = (1.0 - along) * (1.0 - along);
    let probe = clamp(uv + turn * reach * along, gfu.uInputClamp.xy, gfu.uInputClamp.zw);

    coverage += textureSample(uTexture, uSampler, probe).a * weight;
    weights += weight;
    turn = vec2<f32>(
      turn.x * GLOW_TURN_COS - turn.y * GLOW_TURN_SIN,
      turn.x * GLOW_TURN_SIN + turn.y * GLOW_TURN_COS
    );
  }

  coverage /= weights;

  let halo = clamp(coverage * fu.strength * fu.alpha, 0.0, 1.0) * (1.0 - source.a);

  return source + vec4<f32>(fu.color * halo, halo);
}
`;
