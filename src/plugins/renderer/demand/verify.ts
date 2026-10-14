/**
 * @file renderer/demand — the pixel oracle of `debug.verifyFrames`: compares a skipped frame with the frame drawn live,
 * logs `renderer:missed-frame` and draws it. Dev and agent builds only: the call site guards it inline, so a production
 * bundle drops this module.
 */
import type { HostModule, RendererCtx } from "../types";
import type { DemandFrame, DemandState } from "./types";

/** A channel that differs by more than this is a differing pixel: the visual runner's default threshold. */
const CHANNEL_DELTA = 24;

/** More than this share of differing pixels is a missed frame: the visual runner's default ratio. */
const PIXEL_RATIO = 0.001;

/** Bytes of one RGBA pixel. */
const CHANNELS = 4;

/** Entities a missed-frame line names at the most. */
const NAMED = 20;

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
 * The pixel oracle step of `settle`. After a frame whose decision drew (or, with `onDemand` off, would have drawn),
 * the picture becomes the reference. After a `"none"` decision the frame is read live and compared with it: above the
 * runner's ratio the frame was missed, `renderer:missed-frame` names the views marked since the last drawn frame, and,
 * with `onDemand` on, the frame is drawn at once and the decision says `"verify"`.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param state - The demand state.
 * @param host - The host module (`pixels()`, `render()`).
 * @param decided - The decision of this frame, changed in place when a missed frame is drawn.
 */
export function verifyFrame(
  ctx: RendererCtx,
  state: DemandState,
  host: HostModule,
  decided: DemandFrame
): void {
  if (decided.reason !== "none") {
    state.verify.reference = host.pixels();

    return;
  }

  const live = host.pixels();
  const reference = state.verify.reference;

  if (live === undefined) return;

  state.verify.reference = live;

  if (reference === undefined || reference.length !== live.length) return;

  const pixels = differingPixels(reference, live);

  if (pixels <= (live.length / CHANNELS) * PIXEL_RATIO) {
    // Equal enough: the reference stays the picture of the last drawn frame.
    state.verify.reference = reference;

    return;
  }

  ctx.log.warn("renderer:missed-frame", {
    frame: ctx.deps.time.snapshot().frame,
    pixels,
    marked: [...state.sinceDraw].slice(0, NAMED)
  });

  // In shadow mode (onDemand off) the frame was drawn live already.
  if (!ctx.config.onDemand) return;

  host.render();
  decided.drawn = true;
  decided.reason = "verify";
}
