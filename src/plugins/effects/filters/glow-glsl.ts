/**
 * @file effects/filters — the GLSL twin of the `Glow` fragment, the same math as `glow-wgsl.ts`
 * for the WebGL fallback: 64 probes on a golden-angle spiral over the disc of radius `distance`,
 * each weighted by `(1 − r / distance)²`, every probe clamped to the input frame, and the source
 * drawn over the premultiplied halo `color × coverage × strength × alpha`.
 */

/**
 * The GLSL ES 3.0 fragment body of `Glow`. Reads the uniforms `strength`, `distance`, `color` and
 * `alpha` under their bare names.
 */
export const GLOW_GLSL = /* glsl */ `const int GLOW_PROBES = 64;
const float GLOW_TURN_COS = -0.7373688780783197;
const float GLOW_TURN_SIN = 0.6754902942615238;

void main() {
  vec4 source = texture(uTexture, vTextureCoord);
  vec2 reach = uInputSize.zw * distance;
  vec2 turn = vec2(1.0, 0.0);
  float coverage = 0.0;
  float weights = 0.0;

  for (int probeIndex = 0; probeIndex < GLOW_PROBES; probeIndex++) {
    float along = sqrt((float(probeIndex) + 0.5) / float(GLOW_PROBES));
    float weight = (1.0 - along) * (1.0 - along);
    vec2 probe = clamp(vTextureCoord + turn * reach * along, uInputClamp.xy, uInputClamp.zw);

    coverage += texture(uTexture, probe).a * weight;
    weights += weight;
    turn = vec2(
      turn.x * GLOW_TURN_COS - turn.y * GLOW_TURN_SIN,
      turn.x * GLOW_TURN_SIN + turn.y * GLOW_TURN_COS
    );
  }

  coverage /= weights;

  float halo = clamp(coverage * strength * alpha, 0.0, 1.0) * (1.0 - source.a);

  finalColor = source + vec4(color * halo, halo);
}
`;
