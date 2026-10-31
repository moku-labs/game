/**
 * @file What the tests of a shaded view share. Not a test. A quad program as `effects` hands it over, real Pixi over
 * the text of the mesh stage and the four groups, and a slot of a filter that may be shaded: the renderer holds no
 * shader text of its own, so its tests bring theirs.
 */
import * as pixi from "pixi.js";
import type { FilterSlot, FilterSlotQuad } from "../types";

/** The stages of a quad program, shaped as `effects` assembles them: Pixi reads the groups out of this text. */
const QUAD_WGSL = /* wgsl */ `struct GlobalFilterUniforms {
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
struct VSOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aUV: vec2<f32>) -> VSOutput {
  return VSOutput(vec4<f32>(aPosition, 0.0, 1.0), aUV);
}
@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, uv) * fu.amount;
}
`;

/**
 * A program over the text above.
 *
 * @param name - The name the warm-up logs it by.
 * @returns The program.
 */
export function quadProgram(name = "test.quad"): pixi.GpuProgram {
  // A fresh program, not `GpuProgram.from`: a name is part of what a test reads.
  return new pixi.GpuProgram({
    name,
    vertex: { source: QUAD_WGSL, entryPoint: "mainVertex" },
    fragment: { source: QUAD_WGSL, entryPoint: "mainFragment" }
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
