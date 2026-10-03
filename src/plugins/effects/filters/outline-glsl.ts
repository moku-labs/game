/**
 * @file effects/filters — the GLSL twin of the `Outline` fragment, the same math as
 * `outline-wgsl.ts` for the WebGL fallback: the source drawn over a ring of `thickness` pixels in
 * `color × alpha`, sampled in 8 directions, 12 from 6 px.
 */

/**
 * The GLSL ES 3.0 fragment body of `Outline`. Reads the uniforms `thickness`, `color` and `alpha`
 * under their bare names.
 */
export const OUTLINE_GLSL = /* glsl */ `const float OUTLINE_TAU = 6.283185307179586;

void main() {
  vec4 source = texture(uTexture, vTextureCoord);
  vec2 texel = uInputSize.zw;
  int spokes = thickness >= 6.0 ? 12 : 8;
  float edge = 0.0;

  for (int spoke = 0; spoke < spokes; spoke++) {
    float turn = OUTLINE_TAU * float(spoke) / float(spokes);
    vec2 probe = clamp(
      vTextureCoord + vec2(cos(turn), sin(turn)) * texel * thickness,
      uInputClamp.xy,
      uInputClamp.zw
    );

    edge = max(edge, texture(uTexture, probe).a);
  }

  float line = edge * alpha;

  finalColor = source + vec4(color * line, line) * (1.0 - source.a);
}
`;
