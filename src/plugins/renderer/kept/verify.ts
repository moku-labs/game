/**
 * @file renderer/kept — the pixel leg of the K5 oracle (P13.2), behind `debug.verifyFrames`, dev and agent builds
 * only: after a drawn frame in which a picture stood, the stage is read as drawn, then once more with every picture
 * drawn live, and the two are compared with the thresholds of the frame oracle. A difference is a stale picture: it is
 * logged, every record goes live and every range is owed a render (the policy takes them again). The call site guards
 * it inline, so a production bundle drops this module.
 */
import { CHANNELS, differingPixels, NAMED, withinRatio } from "../pixels";
import type { PixiContainer } from "../types";
import { KEY, onGrid } from "./geometry";
import type { KeptCtx, KeptRecord, RangeRecord } from "./types";

/**
 * Tells whether a kept record's quad stands off its picture's grid: it is moving, and sampled linearly (P2.5).
 *
 * @param kctx - The kept context.
 * @param record - The record, kept.
 * @returns True when the frame is not compared.
 */
function offGrid(kctx: KeptCtx, record: KeptRecord): boolean {
  const { key } = record;
  const world = record.top.getGlobalTransform(record.matrix, false);
  const rs = key[KEY.rs] ?? 1;
  const r = kctx.host.resolution();

  return (
    !onGrid(world.tx - (key[KEY.tx] ?? 0), rs, r) || !onGrid(world.ty - (key[KEY.ty] ?? 0), rs, r)
  );
}

/**
 * Tells whether the padded picture of a kept record reaches past the canvas edge, where Pixi clips the live filter.
 *
 * @param record - The record, kept.
 * @param screen - The canvas rectangle, CSS px.
 * @returns True when a side of the padded picture lies outside the canvas.
 */
function crossesEdge(
  record: KeptRecord,
  screen: Readonly<{ x: number; y: number; width: number; height: number }>
): boolean {
  const { key } = record;
  const world = record.top.getGlobalTransform(record.matrix, false);
  const Ps = key[KEY.Ps] ?? 0;
  const x = (key[KEY.X0] ?? 0) - Ps + world.tx - (key[KEY.tx] ?? 0);
  const y = (key[KEY.Y0] ?? 0) - Ps + world.ty - (key[KEY.ty] ?? 0);
  const w = (key[KEY.w1] ?? 0) + 2 * Ps;
  const h = (key[KEY.h1] ?? 0) + 2 * Ps;

  return x < screen.x || y < screen.y || x + w > screen.width || y + h > screen.height;
}

/**
 * The band along the canvas edge the compare skips, CSS px: the padding of a picture that crosses the edge, which Pixi
 * clips live (`clipToViewport`) while the picture is complete.
 *
 * @param kctx - The kept context.
 * @param records - The kept records shown.
 * @returns The widest padding of such a picture; 0 when none crosses.
 */
function edgeBand(kctx: KeptCtx, records: readonly KeptRecord[]): number {
  const screen = kctx.host.screen();
  let band = 0;

  if (screen === undefined) return 0;

  for (const record of records) {
    if (crossesEdge(record, screen)) band = Math.max(band, record.key[KEY.P] ?? 0);
  }

  return band;
}

/**
 * Zeroes the pixels of a band along the edge in both pictures, so the compare leaves them out.
 *
 * @param pictures - The two pictures, RGBA, of the same size.
 * @param width - Their row length, in pixels.
 * @param band - The band, in pixels.
 */
function clearBand(pictures: readonly Uint8ClampedArray[], width: number, band: number): void {
  const height = Math.floor((pictures[0]?.length ?? 0) / CHANNELS / width);

  for (const picture of pictures) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const inBand = x < band || y < band || x >= width - band || y >= height - band;

        if (inBand) picture.fill(0, (y * width + x) * CHANNELS, (y * width + x + 1) * CHANNELS);
      }
    }
  }
}

/**
 * The kept records whose quads stood in the frame.
 *
 * @param kctx - The kept context.
 * @returns The records.
 */
function shownRecords(kctx: KeptCtx): KeptRecord[] {
  return kctx.state.records.filter(
    record => record.mode === "kept" && record.quad?.visible === true
  );
}

/**
 * Reads the stage once more with every picture drawn live: the kept records bypassed, the entries of every range
 * lifted and its sprite hidden. The records draw their pictures again after the read.
 *
 * @param kctx - The kept context.
 * @param ranges - The ranges whose sprite stood in the frame.
 * @param bypass - Draws every kept record live (true) or as its picture again (false).
 * @param resolution - The resolution of the read, the renderer's.
 * @returns The pixels drawn live, or `undefined` when Pixi could not read them.
 */
function renderLive(
  kctx: KeptCtx,
  ranges: readonly RangeRecord[],
  bypass: (on: boolean) => void,
  resolution: number
): Uint8ClampedArray | undefined {
  const lift: PixiContainer[] = ranges.flatMap(range => range.entries);
  const hide: PixiContainer[] = ranges.flatMap(range =>
    range.sprite === undefined ? [] : [range.sprite]
  );

  bypass(true);

  try {
    return kctx.sync.liftFor(kctx.hidden, lift, hide, "freeze", () => kctx.host.pixels(resolution));
  } finally {
    bypass(false);
  }
}

/**
 * Logs a stale picture: the frame, the differing pixels and the labels of the pictures shown, the first `NAMED`.
 *
 * @param kctx - The kept context.
 * @param pixels - The differing pixels.
 * @param records - The kept records shown.
 * @param ranges - The ranges whose sprite stood in the frame.
 */
function logStale(
  kctx: KeptCtx,
  pixels: number,
  records: readonly KeptRecord[],
  ranges: readonly RangeRecord[]
): void {
  kctx.ctx.log.warn("renderer:stale-picture", {
    frame: kctx.ctx.deps.time.snapshot().frame,
    pixels,
    pictures: [
      ...records.map(record => record.quad?.label ?? ""),
      ...ranges.map(range => range.sprite?.label ?? "")
    ].slice(0, NAMED)
  });
}

/**
 * The pixel leg after a drawn frame: the picture as drawn against the same frame with every picture live. Frames in
 * which a picture moves off its grid are skipped and counted; at rest every picture is compared.
 *
 * @param kctx - The kept context.
 * @param bypass - Draws every kept record live (true) or as its picture again (false).
 * @param recover - Draws every kept record live after a stale picture was found.
 */
export function verifyPictures(
  kctx: KeptCtx,
  bypass: (on: boolean) => void,
  recover: () => void
): void {
  const { state, host } = kctx;
  const records = shownRecords(kctx);
  const ranges = [...state.ranges.values()].filter(range => range.sprite !== undefined);

  // No picture stood in the frame: nothing to compare.
  if (records.length === 0 && ranges.length === 0) return;

  // A picture moving off its grid is sampled linearly: the frame is skipped and counted.
  if (records.some(record => offGrid(kctx, record))) {
    state.verifySkipped += 1;

    return;
  }

  // The stage as drawn, then live, both at the renderer's resolution: a live filter of an extract at another
  // resolution draws other pixels.
  const resolution = host.resolution();
  const drawn = host.pixels(resolution);

  if (drawn === undefined) return;

  const live = renderLive(kctx, ranges, bypass, resolution);

  if (live === undefined || live.length !== drawn.length) return;

  // The band Pixi clips live along the canvas edge is left out of the compare.
  const screen = host.screen();
  const width = screen === undefined ? 0 : Math.round(screen.width * resolution);
  const band = Math.ceil(edgeBand(kctx, records) * resolution);

  if (band > 0 && width > 0) clearBand([drawn, live], width, band);

  const pixels = differingPixels(live, drawn);

  if (withinRatio(pixels, live.length)) return;

  logStale(kctx, pixels, records, ranges);

  // Recovery: every picture drawn live, every range rendered again; the policy takes them again.
  recover();
  for (const range of state.ranges.values()) range.due = true;
  kctx.demand.request();
}
