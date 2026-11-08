/**
 * @file What the tests of a shaded view share. Not a test. A quad program as `effects` hands it over, real Pixi over
 * the text of the mesh stage and the four groups, a slot of a filter that may be shaded, and the seam of a filter with
 * one input whose chain the cache holds: the renderer holds no shader text of its own, so its tests bring theirs.
 */
import * as pixi from "pixi.js";
import type { FilterSlot, FilterSlotInputs, FilterSlotQuad } from "../types";

/**
 * The stages of a quad program, shaped as `effects` assembles them: Pixi reads the groups out of this text. Each input
 * gets its texture and sampler at group 3 after `fu`, as `assembleQuad` binds them.
 *
 * @param inputs - The names of the filter's inputs, in declaration order.
 * @returns The text.
 */
function quadWgsl(inputs: readonly string[]): string {
  const bindings = inputs
    .map(
      (input, index) =>
        `@group(3) @binding(${1 + 2 * index}) var ${input}Texture: texture_2d<f32>;\n` +
        `@group(3) @binding(${2 + 2 * index}) var ${input}Sampler: sampler;\n`
    )
    .join("");

  return /* wgsl */ `struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};
struct LocalUniforms { uTransformMatrix: mat3x3<f32>, uColor: vec4<f32>, uRound: f32 };
struct FilterUniforms { amount: f32 };
@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(2) @binding(1) var uTexture: texture_2d<f32>;
@group(2) @binding(2) var uSampler: sampler;
@group(3) @binding(0) var<uniform> fu: FilterUniforms;
${bindings}struct VSOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aUV: vec2<f32>) -> VSOutput {
  return VSOutput(vec4<f32>(aPosition, 0.0, 1.0), aUV);
}
@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, uv) * fu.amount;
}
`;
}

/**
 * A program over the text above.
 *
 * @param name - The name the warm-up logs it by.
 * @param inputs - The names of the filter's inputs; none when left out.
 * @returns The program.
 */
export function quadProgram(name = "test.quad", inputs: readonly string[] = []): pixi.GpuProgram {
  const source = quadWgsl(inputs);

  // A fresh program, not `GpuProgram.from`: a name is part of what a test reads.
  return new pixi.GpuProgram({
    name,
    vertex: { source, entryPoint: "mainVertex" },
    fragment: { source, entryPoint: "mainFragment" }
  });
}

/**
 * The quad of one filter instance: the program and the instance's own numbers.
 *
 * @param name - The program's name.
 * @returns The quad.
 */
export function quadOfFilter(name?: string): FilterSlotQuad {
  return {
    program: quadProgram(name),
    fu: new pixi.UniformGroup({ amount: { value: 1, type: "f32" } })
  };
}

/**
 * The quad of a filter instance that reads inputs, as `effects` hands one for a `Bloom`: the program binds each input's
 * texture and sampler at group 3, and the quad names them, texture then sampler.
 *
 * @param inputs - The names of the filter's inputs.
 * @param fu - The instance's numbers; a group of one `amount` when left out.
 * @returns The quad.
 */
export function chainQuadOfFilter(
  inputs: readonly string[] = ["bright"],
  fu: pixi.UniformGroup | undefined = new pixi.UniformGroup({ amount: { value: 1, type: "f32" } })
): FilterSlotQuad {
  return {
    program: quadProgram("test.chain", inputs),
    fu,
    inputNames: inputs.flatMap(input => [`${input}Texture`, `${input}Sampler`])
  };
}

/** The seam of a filter with one input, as `effects` fills it, and the handle that changes what its chain draws. */
export type ChainSeam = {
  readonly inputs: FilterSlotInputs;
  /** Changes what the stages draw: the chain's version moves, as a new threshold of a `Bloom` moves it. */
  bump(): void;
};

/**
 * Makes the seam of a filter with one input. Its chain draws nothing (no filter applies in these tests): what the cache
 * reads is the version, the scale and the calls.
 *
 * @param scale - The scale the chain's last step draws at; `"empty"` for an empty chain, whose result is the view's own
 *   input.
 * @returns The seam.
 */
export function chainSeam(scale: number | "empty" = 0.5): ChainSeam {
  const chain = { version: 1 };
  const last = scale === "empty" ? undefined : scale;

  return {
    inputs: {
      stages: [],
      count: 1,
      version: () => chain.version,
      scaleOf: () => last,
      draw: () => undefined,
      hold: () => undefined
    },
    bump: () => {
      chain.version += 1;
    }
  };
}

/**
 * A slot that may be shaded: a filter on `"inherit"` with a quad, as `effects` hands one.
 *
 * @param fields - Other fields of the slot.
 * @returns The slot.
 */
export function shadedSlot(fields: Partial<FilterSlot> = {}): FilterSlot {
  const filter = new pixi.ColorMatrixFilter();

  filter.resolution = "inherit";

  return { filter, passes: 1, cache: "local", quad: quadOfFilter(), ...fields };
}

/**
 * A slot of a filter with one input that may be shaded once its chain is held: its seam and a quad that names the input.
 *
 * @param seam - The seam of the filter.
 * @param fields - Other fields of the slot.
 * @returns The slot.
 */
export function chainSlot(
  seam: ChainSeam = chainSeam(),
  fields: Partial<FilterSlot> = {}
): FilterSlot {
  return shadedSlot({ inputs: seam.inputs, quad: chainQuadOfFilter(), ...fields });
}
