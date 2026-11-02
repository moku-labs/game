/**
 * @file renderer/kept — the pixel leg of the K5 oracle (P13.2), behind `debug.verifyFrames`, dev and agent builds
 * only: after a drawn frame in which a picture stood, the stage is read as drawn, then once more with every picture
 * drawn live, and the two are compared with the thresholds of the frame oracle. A difference is a stale picture: it is
 * logged, every record goes live and every range is owed a render (the policy takes them again). The call site guards
 * it inline, so a production bundle drops this module.
 */
import { CHANNELS, differingPixels, NAMED, withinRatio } from "../pixels";
import type { PixiContainer, PixiFilter, PixiModule, PixiRectangle } from "../types";
import { drawnBounds } from "./drawn-bounds";
import { drawnResolution, KEY, linearBounds, onGrid } from "./geometry";
import type { KeptCtx, KeptRecord, RangeRecord } from "./types";

/** What the read of the live frame answers when the frame is not compared. */
const PLACE_DIFFERS = "place";

/**
 * Tells whether a kept record's quad stands off its picture's grid: it is moving, drawn scaled to another linear part
 * than at the take (F67), or drawn at another resolution than the canvas after a step (F126), and sampled linearly
 * (P2.5). The last is the resampling of a picture nothing changed, not a stale one.
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
    drawnResolution(key, record.direct) !== r ||
    world.a !== key[KEY.a] ||
    world.b !== key[KEY.b] ||
    world.c !== key[KEY.c] ||
    world.d !== key[KEY.d] ||
    !onGrid(world.tx - (key[KEY.tx] ?? 0), rs, r) ||
    !onGrid(world.ty - (key[KEY.ty] ?? 0), rs, r)
  );
}

/**
 * Tells whether a kept record is translucent, by its top's own alpha (F120) or an ancestor's (F113): its quad draws
 * `A·F(x)` where live draws `F(A·x)`, which differ by design for a filter that is not alpha-linear, not by a stale
 * picture.
 *
 * @param record - The record, kept.
 * @returns True when the top's alpha or an ancestor's is under 1.
 */
function faded(record: KeptRecord): boolean {
  for (let node: PixiContainer | null = record.top; node !== null; node = node.parent) {
    if (node.alpha < 1) return true;
  }

  return false;
}

/**
 * Where a filter pass starts on one axis, as Pixi works it out (`FilterSystem._calculateFilterBounds`): the bounds cut to
 * the canvas while the stack clips to it, floored to the pass's grid, then padded. Pure.
 *
 * @param start - The bounds' start on the canvas, CSS px.
 * @param resolution - The pass's resolution.
 * @param padding - The pass's padding, whole px.
 * @param clipped - Every enabled filter of the stack has `clipToViewport` on.
 * @returns The pass's start, CSS px.
 * @example
 * ```ts
 * passStart(-5, 1, 8, true); // -8
 * ```
 */
function passStart(start: number, resolution: number, padding: number, clipped: boolean): number {
  const cut = clipped ? Math.max(start, 0) : start;

  return Math.floor(cut * resolution) / resolution - padding;
}

/**
 * The box a filter pass over a node measures, on the node's own axes: its filter area when it holds one, which replaces
 * the bounds, else what its subtree draws. Read with every picture live: the tree then holds the views, not their quads,
 * which stand padded.
 *
 * @param pixi - The module that draws.
 * @param node - The node.
 * @returns The box.
 */
function passBox(
  pixi: PixiModule,
  node: PixiContainer
): { minX: number; minY: number; maxX: number; maxY: number } {
  // Pixi answers `undefined` or `null` for a node with no area, which its getter type does not say.
  const area: PixiRectangle | null | undefined = node.filterArea;

  if (area === null || area === undefined) return drawnBounds(pixi, node);

  const { x, y, width, height } = area;

  return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

/**
 * Tells whether a filter pass over a node starts off the canvas origin.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param node - The node.
 * @param filters - Its enabled filters.
 * @returns True when it does.
 */
function passOffOrigin(
  kctx: KeptCtx,
  pixi: PixiModule,
  node: PixiContainer,
  filters: readonly PixiFilter[]
): boolean {
  const canvasResolution = kctx.host.resolution();
  const resolutions = filters.map(({ resolution }) =>
    resolution === "inherit" ? canvasResolution : resolution
  );
  const resolution = Math.min(...resolutions);
  const clipped = filters.every(filter => filter.clipToViewport);
  // Whole px, as Pixi's `padding | 0`.
  const padding = Math.trunc(filters.reduce((sum, filter) => sum + filter.padding, 0));
  const { a, b, c, d, tx, ty } = node.getGlobalTransform(new pixi.Matrix(), false);
  const box = linearBounds(a, b, c, d, passBox(pixi, node));

  return (
    passStart(tx + box.x0, resolution, padding, clipped) !== 0 ||
    passStart(ty + box.y0, resolution, padding, clipped) !== 0
  );
}

/**
 * Tells whether a shaded placed record hangs under a filter whose pass starts off the canvas origin. Live, its body
 * reads a place relative to that pass's texture; on the mesh it reads the canvas (spec 23 P8.3). The two differ by that
 * origin by design, not by a stale picture. Only the closest filter counts: Pixi offsets by that one alone. Read with
 * every picture live: a kept ancestor's filters are back on its top, and the views are back in the tree.
 *
 * @param kctx - The kept context.
 * @param record - The record, kept.
 * @returns True when the frame is not compared.
 */
function placeDiffers(kctx: KeptCtx, record: KeptRecord): boolean {
  const pixi = kctx.host.pixi();

  if (!record.shaded || record.category !== "placed" || pixi === undefined) return false;

  for (let node = record.top.parent; node !== null; node = node.parent) {
    const held: readonly PixiFilter[] | null | undefined = node.filters;
    const filters = held?.filter(filter => filter.enabled) ?? [];

    if (filters.length > 0) return passOffOrigin(kctx, pixi, node, filters);
  }

  return false;
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

  if (screen === undefined) return 0;

  let band = 0;

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
 * Runs a draw with every picture drawn live: the kept records bypassed, the entries of every range with a sprite lifted
 * and its sprite hidden. The records draw their pictures again after it, the ranges show their sprites again.
 *
 * @param kctx - The kept context.
 * @param bypass - Draws every kept record live (true) or as its picture again (false).
 * @param draw - The render or the read.
 * @returns What `draw` returned.
 */
export function drawLive<Result>(
  kctx: KeptCtx,
  bypass: (on: boolean) => void,
  draw: () => Result
): Result {
  const ranges = [...kctx.state.ranges.values()].filter(range => range.sprite !== undefined);
  const lift: PixiContainer[] = ranges.flatMap(range => range.entries);
  const hide: PixiContainer[] = ranges.flatMap(range =>
    range.sprite === undefined ? [] : [range.sprite]
  );

  bypass(true);

  try {
    return kctx.sync.liftFor(kctx.hidden, lift, hide, "freeze", draw);
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
 * which a picture moves off its grid, was drawn at another resolution (F126), is translucent itself (F120), hangs
 * under a translucent ancestor (F113) or reads its place under a filter off the canvas origin are skipped and counted;
 * at rest, opaque, under opaque ancestors every picture is compared.
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

  // A picture moving off its grid or kept through a step of the resolution is sampled linearly, a fading one or one under
  // a fading ancestor is faded after its filters: the frame is skipped and counted.
  const uncomparable = records.some(record => offGrid(kctx, record) || faded(record));

  if (uncomparable) {
    state.verifySkipped += 1;

    return;
  }

  // The stage as drawn, then live, both at the renderer's resolution: a live filter of an extract at another
  // resolution draws other pixels.
  const resolution = host.resolution();
  const drawn = host.pixels(resolution);

  if (drawn === undefined) return;

  // A place read under a filter off the origin differs from live by that origin: skipped and counted as well.
  const live = drawLive(kctx, bypass, () =>
    records.some(record => placeDiffers(kctx, record)) ? PLACE_DIFFERS : host.pixels(resolution)
  );

  if (live === PLACE_DIFFERS) {
    state.verifySkipped += 1;

    return;
  }

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
