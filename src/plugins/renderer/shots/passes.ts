/**
 * @file renderer/shots — the passes of one take, in one command encoder, submitted once: the canvas down through the
 * hops to the shot, then a horizontal and a vertical Gaussian through one extra texture of the shot's size. What only
 * the take needs is made here and destroyed after the submit. A take may allocate: it runs once per switch.
 */
import { blurData, boxData, type GaussianTap, gaussianTaps, hopsOf, type ShotSize } from "./chain";
import { SHOT_FORMAT } from "./shader";
import type { ShotPipes } from "./types";

/** `GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT`. */
const HOP_USAGE = 0x04 | 0x10;

/** `GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM`. */
const UNIFORM_USAGE = 0x08 | 0x40;

/** What the passes of one take share. */
type Run = {
  device: GPUDevice;
  pipes: ShotPipes;
  encoder: GPUCommandEncoder;
  /** What goes after the submit: the GPU reads them until then. */
  spent: Array<GPUTexture | GPUBuffer>;
};

/**
 * Makes a texture for this take alone.
 *
 * @param run - The take.
 * @param size - Its size.
 * @returns The texture.
 */
function hopTexture(run: Run, size: ShotSize): GPUTexture {
  const texture = run.device.createTexture({ size, format: SHOT_FORMAT, usage: HOP_USAGE });

  run.spent.push(texture);

  return texture;
}

/**
 * Draws one pass: a fullscreen triangle of a filter, from a texture onto another.
 *
 * @param run - The take.
 * @param pipeline - The filter.
 * @param source - What it reads.
 * @param target - What it draws.
 * @param data - Its uniform.
 */
function drawPass(
  run: Run,
  pipeline: GPURenderPipeline,
  source: GPUTexture,
  target: GPUTexture,
  data: Float32Array<ArrayBuffer>
): void {
  const { device, encoder, pipes, spent } = run;
  const uniform = device.createBuffer({ size: data.byteLength, usage: UNIFORM_USAGE });

  spent.push(uniform);
  device.queue.writeBuffer(uniform, 0, data);

  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: source.createView() },
      { binding: 1, resource: pipes.sampler },
      { binding: 2, resource: { buffer: uniform } }
    ]
  });
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store" }]
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.draw(3);
  pass.end();
}

/**
 * Draws the hops from the canvas down to the shot.
 *
 * @param run - The take.
 * @param canvas - The canvas texture of this frame.
 * @param shot - The texture of the shot.
 */
function drawHops(run: Run, canvas: GPUTexture, shot: GPUTexture): void {
  const hops = hopsOf(canvas.width, canvas.height, shot.width, shot.height);
  let source = canvas;

  for (const [index, hop] of hops.entries()) {
    const last = index === hops.length - 1;
    const target = last ? shot : hopTexture(run, hop);

    drawPass(run, run.pipes.box, source, target, boxData(source, hop, last));
    source = target;
  }
}

/**
 * Blurs the shot in place: across into a texture of its size, and back down.
 *
 * @param run - The take.
 * @param shot - The texture of the shot.
 * @param taps - The kernel.
 */
function drawBlur(run: Run, shot: GPUTexture, taps: readonly GaussianTap[]): void {
  const across = hopTexture(run, shot);

  drawPass(run, run.pipes.blur, shot, across, blurData(shot, "x", taps));
  drawPass(run, run.pipes.blur, across, shot, blurData(shot, "y", taps));
}

/**
 * Takes one picture of the canvas into every target: the chain draws the first, and the others are copies of it, so
 * two keys of one frame cost one chain.
 *
 * @param device - The device.
 * @param pipes - The pipelines of that device.
 * @param canvas - The canvas texture of this frame.
 * @param targets - The textures of the shots, each once, all of one size.
 * @param sigma - The Gaussian in texels of the shot; 0 for none.
 */
export function drawShot(
  device: GPUDevice,
  pipes: ShotPipes,
  canvas: GPUTexture,
  targets: readonly GPUTexture[],
  sigma: number
): void {
  const [shot, ...copies] = targets;

  if (shot === undefined) return;

  const encoder = device.createCommandEncoder();
  const run: Run = { device, pipes, encoder, spent: [] };
  const taps = gaussianTaps(sigma);

  drawHops(run, canvas, shot);
  if (taps.length > 0) drawBlur(run, shot, taps);
  for (const copy of copies)
    encoder.copyTextureToTexture({ texture: shot }, { texture: copy }, shot);
  device.queue.submit([encoder.finish()]);
  for (const resource of run.spent) resource.destroy();
}
