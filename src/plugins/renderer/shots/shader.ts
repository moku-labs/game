/**
 * @file renderer/shots — the two filters of a chain and their pipelines: a box filter of bilinear taps and one axis of a
 * Gaussian. One fullscreen triangle each, reading a texture through a sampler. Their weights and sizes live in uniforms
 * (`chain.ts` writes them), so a kernel that follows the frame's width needs no new pipeline.
 */
import { MAX_TAPS } from "./chain";
import type { ShotPipes } from "./types";

/** The format of a shot, of the hops between the canvas and it, and so of both pipelines' target. */
export const SHOT_FORMAT = "bgra8unorm";

/** The vertex stage and the two bindings every filter reads: a triangle over the whole target. */
const SHARED_WGSL = /* wgsl */ `
@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var smooth_sampler: sampler;

@vertex fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));

  return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** The box filter: `count` x `count` taps round the centre of a target pixel, `step` source pixels apart. */
const BOX_WGSL = /* wgsl */ `${SHARED_WGSL}
struct Box {
  texel: vec2f,
  spacing: vec2f,
  size: vec2f,
  count: f32,
};

@group(0) @binding(2) var<uniform> box: Box;

@fragment fn fragment_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = position.xy / box.size;
  let count = i32(box.count);
  let centre = (box.count - 1.0) / 2.0;
  var sum = vec4f(0.0);

  for (var y = 0; y < count; y++) {
    for (var x = 0; x < count; x++) {
      let place = (vec2f(f32(x), f32(y)) - centre) * box.spacing * box.texel;

      sum += textureSampleLevel(picture, smooth_sampler, uv + place, 0.0);
    }
  }

  return vec4f(sum.rgb / (box.count * box.count), 1.0);
}
`;

/** One axis of the Gaussian: the centre, then each tap on both sides. A tap's `x` is its offset, its `y` its weight. */
const BLUR_WGSL = /* wgsl */ `${SHARED_WGSL}
struct Kernel {
  axis: vec2f,
  size: vec2f,
  count: f32,
  taps: array<vec4f, ${MAX_TAPS}>,
};

@group(0) @binding(2) var<uniform> kernel: Kernel;

@fragment fn fragment_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = position.xy / kernel.size;
  var sum = textureSampleLevel(picture, smooth_sampler, uv, 0.0) * kernel.taps[0].y;

  for (var index = 1; index < i32(kernel.count); index++) {
    let tap = kernel.taps[index];
    let place = tap.x * kernel.axis;

    sum += textureSampleLevel(picture, smooth_sampler, uv + place, 0.0) * tap.y;
    sum += textureSampleLevel(picture, smooth_sampler, uv - place, 0.0) * tap.y;
  }

  return vec4f(sum.rgb, 1.0);
}
`;

/**
 * Compiles one filter off the main thread.
 *
 * @param device - The device.
 * @param code - Its WGSL.
 * @returns The pipeline.
 */
function pipelineOf(device: GPUDevice, code: string): Promise<GPURenderPipeline> {
  const module = device.createShaderModule({ code });

  return device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module, entryPoint: "vertex_main" },
    fragment: { module, entryPoint: "fragment_main", targets: [{ format: SHOT_FORMAT }] },
    primitive: { topology: "triangle-list" }
  });
}

/**
 * Compiles the pipelines of a device, off the main thread: a take never compiles in the tap frame.
 *
 * @param device - The device.
 * @returns The pipelines and their sampler.
 */
export async function createShotPipes(device: GPUDevice): Promise<ShotPipes> {
  const [box, blur] = await Promise.all([
    pipelineOf(device, BOX_WGSL),
    pipelineOf(device, BLUR_WGSL)
  ]);
  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge"
  });

  return { box, blur, sampler };
}
