/**
 * @file renderer/shots — the arithmetic of a take: the sizes the chain goes through, one axis of the Gaussian folded
 * into bilinear taps, and the uniforms the two filters read. Pure: the passes are in `passes.ts`.
 */

/** A size in texels. */
export type ShotSize = { width: number; height: number };

/** One tap of a half kernel: how far from the centre, in texels, and the weight of each of the tap's two sides. */
export type GaussianTap = { offset: number; weight: number };

/** The factor of a hop: its output texel centre falls on a corner of source pixels, so 2 x 2 taps are an exact box. */
const HOP_FACTOR = 4;

/** The most taps of a kernel: what the uniform of the blur holds. */
export const MAX_TAPS = 16;

/** The widest radius of a kernel: the centre, and 15 pairs. */
const MAX_RADIUS = (MAX_TAPS - 1) * 2;

/** The radius of a kernel, in sigmas. */
const RADIUS_SIGMAS = 3;

/** The widest blur, in texels of the shot: its radius is the widest the uniform holds. */
const MAX_SIGMA = MAX_RADIUS / RADIUS_SIGMAS;

/** Taps a side of an exact box: each averages two source pixels, at 2 texels from the next. */
const BOX_TAPS = 2;

/** Taps a side of any other hop, spread evenly over it. */
const SPREAD_TAPS = 3;

/** Floats of the box uniform: `texel`, `step`, `size`, `count` and its padding. */
const BOX_FLOATS = 8;

/** Where the taps start in the blur uniform: an array of `vec4f` is aligned to 16 bytes, past `count`. */
const KERNEL_HEAD = 8;

/** Floats of one tap in the blur uniform: a `vec4f`. */
const TAP_FLOATS = 4;

/**
 * The sizes a chain draws into, the shot last: the canvas divided by 4, rounding up, while that stays at least twice
 * the shot's size, then the shot. A last hop of a ratio near 1 would sample without averaging anything, so a canvas
 * smaller than 8 x the shot goes straight to it.
 *
 * @param canvasWidth - The canvas in device pixels, across.
 * @param canvasHeight - The canvas in device pixels, down.
 * @param width - The shot, across.
 * @param height - The shot, down.
 * @returns The hops, in order.
 * @example
 * ```ts
 * hopsOf(1080, 2340, 96, 208); // [{ width: 270, height: 585 }, { width: 96, height: 208 }]
 * ```
 */
export function hopsOf(
  canvasWidth: number,
  canvasHeight: number,
  width: number,
  height: number
): ShotSize[] {
  const hops: ShotSize[] = [];
  let hopWidth = Math.ceil(canvasWidth / HOP_FACTOR);
  let hopHeight = Math.ceil(canvasHeight / HOP_FACTOR);

  while (hopWidth >= 2 * width && hopHeight >= 2 * height) {
    hops.push({ width: hopWidth, height: hopHeight });
    hopWidth = Math.ceil(hopWidth / HOP_FACTOR);
    hopHeight = Math.ceil(hopHeight / HOP_FACTOR);
  }

  hops.push({ width, height });

  return hops;
}

/**
 * One side of a Gaussian of radius `ceil(3 * sigma)`, normalised so the centre and twice the rest make 1, its
 * neighbouring texels paired into one bilinear tap at their weights' centre. At most `MAX_TAPS` taps.
 *
 * @param sigma - The sigma in texels; 0 or less is no blur.
 * @returns The taps, the centre first; none for no blur.
 * @example
 * ```ts
 * gaussianTaps(0); // []
 * ```
 */
export function gaussianTaps(sigma: number): GaussianTap[] {
  if (sigma <= 0) return [];

  const radius = Math.min(Math.ceil(RADIUS_SIGMAS * sigma), MAX_RADIUS);
  const spread = 2 * sigma * sigma;
  const weightAt = (texel: number): number => Math.exp(-(texel * texel) / spread);
  let total = 1;

  for (let texel = 1; texel <= radius; texel += 1) total += 2 * weightAt(texel);

  const taps: GaussianTap[] = [{ offset: 0, weight: 1 / total }];

  for (let texel = 1; texel <= radius; texel += 2) {
    const near = weightAt(texel);
    // A radius that ends on the first of a pair: the last texel stands alone.
    const far = texel < radius ? weightAt(texel + 1) : 0;
    const pair = near + far;

    // A tiny sigma: the weights fall to 0 past the centre, and an offset of 0 / 0 would black the shot out.
    if (pair > 0)
      taps.push({ offset: (texel * near + (texel + 1) * far) / pair, weight: pair / total });
  }

  return taps;
}

/**
 * The sigma of a take in texels of the shot, from the reference units of the config, capped.
 *
 * @param blur - `shots.blur`.
 * @param width - `shots.width`.
 * @param frameWidth - The frame's width in reference units now; 0 while there is no frame.
 * @returns The sigma; 0 for no blur.
 * @example
 * ```ts
 * sigmaOf(54, 96, 1080); // 4.8
 * ```
 */
export function sigmaOf(blur: number, width: number, frameWidth: number): number {
  return frameWidth > 0 ? Math.min((blur * width) / frameWidth, MAX_SIGMA) : 0;
}

/**
 * The uniform of a hop. A hop of a factor of 4 takes two taps a side at +-1 source pixel: an exact box of 4 x 4. The
 * last hop, of any other factor, takes three a side, a third of the ratio apart.
 *
 * @param source - What it reads.
 * @param target - What it draws.
 * @param last - True for the hop that ends at the shot.
 * @returns `texel`, `step`, `size`, `count` of the box shader.
 * @example
 * ```ts
 * boxData({ width: 8, height: 4 }, { width: 2, height: 1 }, false); // [0.125, 0.25, 2, 2, 2, 1, 2, 0]
 * ```
 */
export function boxData(
  source: ShotSize,
  target: ShotSize,
  last: boolean
): Float32Array<ArrayBuffer> {
  const ratioX = source.width / target.width;
  const ratioY = source.height / target.height;
  const exactBox = !last || (ratioX === HOP_FACTOR && ratioY === HOP_FACTOR);
  const data = new Float32Array(BOX_FLOATS);

  data.set([
    1 / source.width,
    1 / source.height,
    exactBox ? BOX_TAPS : ratioX / SPREAD_TAPS,
    exactBox ? BOX_TAPS : ratioY / SPREAD_TAPS,
    target.width,
    target.height,
    exactBox ? BOX_TAPS : SPREAD_TAPS
  ]);

  return data;
}

/**
 * The uniform of one axis of the Gaussian: one texel along that axis, the size, the tap count, and each tap as the `x`
 * and `y` of a `vec4f`.
 *
 * @param size - The shot.
 * @param axis - The axis of the pass.
 * @param taps - The kernel, at most `MAX_TAPS`.
 * @returns `axis`, `size`, `count`, `taps` of the blur shader.
 * @example
 * ```ts
 * blurData({ width: 4, height: 2 }, "y", [{ offset: 0, weight: 1 }]).slice(0, 5); // [0, 0.5, 4, 2, 1]
 * ```
 */
export function blurData(
  size: ShotSize,
  axis: "x" | "y",
  taps: readonly GaussianTap[]
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(KERNEL_HEAD + MAX_TAPS * TAP_FLOATS);

  data.set([
    axis === "x" ? 1 / size.width : 0,
    axis === "y" ? 1 / size.height : 0,
    size.width,
    size.height,
    taps.length
  ]);

  for (const [index, tap] of taps.entries()) {
    data.set([tap.offset, tap.weight], KERNEL_HEAD + index * TAP_FLOATS);
  }

  return data;
}
