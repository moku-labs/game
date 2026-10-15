/**
 * @file renderer plugin — the pixel compare the two oracles of `debug.verifyFrames` share: the frame oracle of `demand`
 * and the picture oracle of `kept`, with the visual runner's default thresholds. A plain module of the plugin root, so
 * neither module imports the other's run-time code (L1). Dev and agent builds only: both call sites guard inline.
 */

/** A channel that differs by more than this is a differing pixel: the visual runner's default threshold. */
const CHANNEL_DELTA = 24;

/** More than this share of differing pixels is a missed frame or a stale picture: the visual runner's default ratio. */
const PIXEL_RATIO = 0.001;

/** Bytes of one RGBA pixel. */
export const CHANNELS = 4;

/** Entities or pictures one oracle line names at the most. */
export const NAMED = 20;

/**
 * Counts the pixels of two pictures of the same size that differ by more than `CHANNEL_DELTA` in a channel.
 *
 * @param expected - The reference RGBA bytes.
 * @param actual - The live RGBA bytes, as long as `expected`.
 * @returns The differing pixels.
 * @example
 * ```ts
 * differingPixels(new Uint8ClampedArray([0, 0, 0, 255, 9, 9, 9, 255]), new Uint8ClampedArray([0, 0, 0, 255, 90, 9, 9, 255])); // 1
 * ```
 */
export function differingPixels(expected: Uint8ClampedArray, actual: Uint8ClampedArray): number {
  let differing = 0;

  for (let at = 0; at < expected.length; at += CHANNELS) {
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      const delta = Math.abs((expected[at + channel] ?? 0) - (actual[at + channel] ?? 0));

      if (delta > CHANNEL_DELTA) {
        differing += 1;
        break;
      }
    }
  }

  return differing;
}

/**
 * Tells whether the differing pixels of a compare stay within the runner's ratio of the picture: equal enough.
 *
 * @param differing - The differing pixels.
 * @param bytes - The RGBA bytes of one picture.
 * @returns True when the two pictures count as the same.
 * @example
 * ```ts
 * withinRatio(4, 40_000); // true: 4 of 10 000 pixels is not above 0.1 %
 * ```
 */
export function withinRatio(differing: number, bytes: number): boolean {
  return differing <= (bytes / CHANNELS) * PIXEL_RATIO;
}
