/**
 * @file effects/filters — the GLSL twin of the `Outline` fragment, the same math as `outline-wgsl.ts` for the WebGL
 * fallback: the source drawn over a hard ring of `thickness` CSS px in `color × alpha`, 12 probes.
 */

/**
 * The GLSL ES 3.0 fragment body of `Outline`. Reads the uniforms `thickness`, `color` and `alpha` under their bare
 * names, and the place helpers of the effect set's head.
 */
export const OUTLINE_GLSL = /* glsl */ `const float OUTLINE_TAU = 6.283185307179586;

void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec4 c = sampleInput(n);
  vec2 reach = thickness / inputFrame();
  float ring = 0.0;

  for (int i = 0; i < 12; i++) {
    float turn = OUTLINE_TAU * float(i) / 12.0;
    ring = max(ring, sampleInput(n + vec2(cos(turn), sin(turn)) * reach).a);
  }

  float line = ring * alpha;

  finalColor = c + vec4(color * line, line) * (1.0 - c.a);
}
`;
