/**
 * @file effects plugin — the fixture filters of the filter-input tests (ported from A Memory Missing's
 * `frost-pipeline.test.ts`). Not a test file: the projects only collect `*.test.ts`. `Small` and `Smaller` copy their
 * input; `Along` blurs along a direction; `Soft` reads a second texture `soft` whose first stage and scale follow
 * `spread` (an empty chain at `spread: 0`, one Gaussian fewer below resolution 1.5); `Bad` reads a name it never
 * declared; `Hazy` names `Bad` in its chain; `SoftDim` is a one-pass fallback over `spread`; `Veiled` is `Soft` with
 * `SoftDim` as its fallback. `Under` is a backdrop filter that reads what was drawn under its view through
 * `sampleBack`; `Frosted` is `Soft` as a backdrop, its input drawn from what was drawn under the view.
 */
import { defineFilter } from "../filters/define";
import type { FilterChainContext, FilterStep } from "../filters/types";

/** The WGSL and GLSL of a stage that copies its input. */
const COPY = {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv); }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord); }"
} as const;

/** A stage with no uniform: a smaller copy. */
export const Small = defineFilter("fixture.small", COPY);

/** Another one, for a chain that changes what it draws first. */
export const Smaller = defineFilter("fixture.smaller", {
  wgsl: `${COPY.wgsl}\n`,
  glsl: `${COPY.glsl}\n`
});

/** A stage with uniforms: a blur along a direction. */
export const Along = defineFilter("fixture.along", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv + fu.dir * fu.sigma); }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord + dir * sigma); }",
  uniforms: { dir: [0, 0], sigma: 0 }
});

/** A stage that reads a name it never declared: it compiles on no device. */
export const Bad = defineFilter("fixture.bad", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv) * missing; }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord) * missing; }"
});

/** What a fake driver says about `Bad`: the line and the name. */
export const BAD_LOG = "ERROR: 0:12: 'missing' : undeclared identifier\n";

/** The one-pass fallback of `Soft` and `Hazy`: it dims by `spread`, a subset of their uniforms. */
export const SoftDim = defineFilter("fixture.softDim", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv) * fu.spread; }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord) * spread; }",
  uniforms: { spread: 1 }
});

/** The stored value the chain of `Soft` reads. */
type SoftValue = { readonly spread: number; readonly tone: number };

/**
 * The chain of `Soft`: nothing at `spread: 0`; the first stage and its scale follow `spread`; then a Gaussian along x
 * and, above resolution 1.5, along y, both at a quarter.
 *
 * @param value - The stored value of the filter.
 * @param context - The resolution of the texture the view is drawn into.
 * @returns The steps.
 */
export function softChain(value: SoftValue, context: FilterChainContext): readonly FilterStep[] {
  if (value.spread <= 0) return [];

  const first: FilterStep =
    value.spread > 1 ? { stage: Smaller, scale: 1 / 4 } : { stage: Small, scale: 1 / 2 };
  const alongX: FilterStep = {
    stage: Along,
    scale: 1 / 4,
    uniforms: { dir: [1, 0], sigma: value.spread }
  };
  const alongY: FilterStep = {
    stage: Along,
    scale: 1 / 4,
    uniforms: { dir: [0, 1], sigma: value.spread }
  };

  return context.resolution > 1.5 ? [first, alongX, alongY] : [first, alongX];
}

/** The bodies of `Soft`: they read the second texture through `sampleSoft`. */
export const SOFT_BODIES = {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return sampleSoft(uv) * fu.spread + vec4<f32>(fu.tone); }",
  glsl: "void main() { finalColor = sampleSoft(vTextureCoord) * spread + vec4(tone); }"
} as const;

/** The stages `Soft`'s chain may name. */
export const SOFT_STAGES = [Small, Smaller, Along];

/** A filter that reads a second texture: a smaller copy of its input, blurred. `tone` is a uniform the chain ignores. */
export const Soft = defineFilter("fixture.soft", {
  ...SOFT_BODIES,
  uniforms: { spread: 1, tone: 0 },
  inputs: { soft: { stages: SOFT_STAGES, chain: softChain } }
});

/** `Soft` with a fallback: what a sheet keeps when the filter cannot draw. */
export const Veiled = defineFilter("fixture.veiled", {
  ...SOFT_BODIES,
  uniforms: { spread: 1, tone: 0 },
  inputs: { soft: { stages: SOFT_STAGES, chain: softChain } },
  fallback: SoftDim
});

/** The bodies of `Under`: what was drawn under the view, read through `sampleBack` and dimmed by `spread`. */
export const UNDER_BODIES = {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return sampleBack(uv) * fu.spread; }",
  glsl: "void main() { finalColor = sampleBack(vTextureCoord) * spread; }"
} as const;

/** A backdrop filter without inputs: what was drawn under the view, dimmed. */
export const Under = defineFilter("fixture.under", {
  ...UNDER_BODIES,
  uniforms: { spread: 1 },
  backdrop: true
});

/** `Soft` as a backdrop: its input `soft` is a blurred copy of what was drawn under the view. */
export const Frosted = defineFilter("fixture.frosted", {
  ...SOFT_BODIES,
  uniforms: { spread: 1, tone: 0 },
  backdrop: true,
  inputs: { soft: { from: "back", stages: SOFT_STAGES, chain: softChain } }
});

/** A filter whose chain names the stage that does not compile, with a fallback. */
export const Hazy = defineFilter("fixture.hazy", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return sampleHaze(uv) * fu.spread; }",
  glsl: "void main() { finalColor = sampleHaze(vTextureCoord) * spread; }",
  uniforms: { spread: 1 },
  inputs: {
    haze: {
      stages: [Small, Bad],
      chain: (): readonly FilterStep[] => [
        { stage: Small, scale: 1 / 2 },
        { stage: Bad, scale: 1 / 2 }
      ]
    }
  },
  fallback: SoftDim
});
