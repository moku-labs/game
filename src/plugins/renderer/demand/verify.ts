/**
 * @file renderer/demand — the pixel oracle of `debug.verifyFrames`: compares a skipped frame with the frame drawn live,
 * logs `renderer:missed-frame` and draws it. Dev and agent builds only: the call site guards it inline, so a production
 * bundle drops this module.
 */
import { differingPixels, NAMED, withinRatio } from "../pixels";
import type { HostModule, KeptState, RendererCtx } from "../types";
import type { DemandFrame, DemandState } from "./types";

/**
 * The resolution the oracle reads the stage at: half, a quarter of the pixels; the renderer's own while a kept
 * picture or a range picture exists (spec 23), since an extract at another resolution draws a live filter other than
 * the canvas does while a picture is a texture of the canvas resolution.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param host - The host module (`resolution()`).
 * @returns Device pixels per CSS pixel; `undefined` for the half resolution of `host.pixels`.
 */
function readResolution(ctx: RendererCtx, host: HostModule): number | undefined {
  return hasPictures(ctx.state.kept) ? host.resolution() : undefined;
}

/**
 * Tells whether the kept cache holds a picture: a kept view's record or an overlay's range.
 *
 * @param kept - The kept state.
 * @returns True while one exists.
 */
function hasPictures(kept: KeptState): boolean {
  return kept.records.length > 0 || kept.ranges.size > 0;
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
  const resolution = readResolution(ctx, host);

  if (decided.reason !== "none") {
    state.verify.reference = host.pixels(resolution);

    return;
  }

  const live = host.pixels(resolution);
  const reference = state.verify.reference;

  if (live === undefined) return;

  state.verify.reference = live;

  if (reference === undefined || reference.length !== live.length) return;

  const pixels = differingPixels(reference, live);

  if (withinRatio(pixels, live.length)) {
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
