/**
 * @file renderer/monitor — the capture of a frame and its options: the checks of the options, the
 * drawn frame a picture is taken on, the legend measured on that very frame, the layers left out of
 * the extract, the frames of a contact sheet, and the answer drawn from them. Dev builds only: the
 * two callers start with the inline dev guard, `capture()` in `monitor/api.ts` and the
 * `lifecycle:changed` hook in `handlers.ts`, which hands a pause to `servePaused`.
 */
import type { Api as TimeApi } from "../../time/types";
import type { PixiContainer, Point } from "../types";
import { diffPicture, legendPicture, numberLegend, pictureRect, sheetPicture } from "./picture";
import type {
  Captured,
  CaptureOptions,
  LegendEntry,
  MonitorCtx,
  MonitorState,
  PictureRequest,
  Shot
} from "./types";

/** Drawn frames a sheet waits for game time to grow before it gives up. */
const MAX_WAIT_FRAMES = 600;

/** Fewest and most frames of a sheet. */
const SHEET_FRAMES = { min: 2, max: 12 } as const;

/** Longest spacing of two frames of a sheet, in milliseconds of game time. */
const SHEET_MAX_MS = 5000;

/** The options, in the order the messages name them. */
const OPTION_NAMES = ["legend", "layers", "sheet", "against"] as const;

/** The name of one option of `capture()`. */
type OptionName = (typeof OPTION_NAMES)[number];

/** The spacing of a contact sheet. */
type Sheet = NonNullable<CaptureOptions["sheet"]>;

/** What one picture is taken with: the layers drawn, and whether the legend is measured. */
type Take = { layers: readonly string[] | undefined; legend: boolean };

/**
 * Builds the error of a sheet combined with an option that draws on one picture.
 *
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * sheetAlone().message; // "[game] game.capture takes a sheet on its own.\n  Drop legend and against, or drop sheet."
 * ```
 */
export function sheetAlone(): Error {
  return new Error(
    "[game] game.capture takes a sheet on its own.\n  Drop legend and against, or drop sheet."
  );
}

/**
 * Builds the error of a layer name the scene does not declare.
 *
 * @param name - The name asked for.
 * @param scene - The layer names of the scene.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * layerMissing("sky", ["board", "hud"]).message;
 * // '[game] game.capture: layer "sky" is not in the scene.\n  Use one of "board", "hud".'
 * ```
 */
function layerMissing(name: string, scene: readonly string[]): Error {
  const fix =
    scene.length === 0
      ? "Declare the layers of the scene first"
      : `Use one of ${scene.map(layer => JSON.stringify(layer)).join(", ")}`;

  return new Error(`[game] game.capture: layer "${name}" is not in the scene.\n  ${fix}.`);
}

/**
 * Builds the error of an option that needs a 2D canvas where there is none.
 *
 * @param option - The first option given.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * needsCanvas("legend").message.startsWith("[game] game.capture needs OffscreenCanvas for legend."); // true
 * ```
 */
function needsCanvas(option: OptionName): Error {
  return new Error(
    `[game] game.capture needs OffscreenCanvas for ${option}.\n  Capture in a browser, or leave the option out.`
  );
}

/**
 * Builds the error of a running sheet whose game time stood still.
 *
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * timeStood().message.startsWith("[game] game.capture sheet: game time did not advance."); // true
 * ```
 */
function timeStood(): Error {
  return new Error(
    "[game] game.capture sheet: game time did not advance.\n  Set game.timeScale above 0 or pause the game."
  );
}

/**
 * The options a capture was given: `legend` when true, the others when present.
 *
 * @param options - The options of `capture()`.
 * @returns Their names, in the order the messages name them.
 * @example
 * ```ts
 * givenOptions({ legend: false, layers: ["hud"] }); // ["layers"]
 * ```
 */
export function givenOptions(options: CaptureOptions): OptionName[] {
  return OPTION_NAMES.filter(name =>
    name === "legend" ? options.legend === true : options[name] !== undefined
  );
}

/**
 * Tells whether a sheet is in range: 2 to 12 whole frames, above 0 and at most 5000 ms apart.
 *
 * @param sheet - The sheet.
 * @returns True when it is.
 * @example
 * ```ts
 * sheetInRange({ frames: 6, everyMs: 100 }); // true
 * ```
 */
function sheetInRange(sheet: Sheet): boolean {
  const { frames, everyMs } = sheet;

  return (
    Number.isInteger(frames) &&
    frames >= SHEET_FRAMES.min &&
    frames <= SHEET_FRAMES.max &&
    Number.isFinite(everyMs) &&
    everyMs > 0 &&
    everyMs <= SHEET_MAX_MS
  );
}

/**
 * Refuses option values `capture()` cannot draw.
 *
 * @param options - The options of `capture()`.
 * @param scene - The layer names of the scene, `world.projection.layers()`.
 * @throws {Error} When a sheet comes with `legend` or `against`, when a layer is not in the scene
 *   or the list is empty, and when a sheet is out of range.
 */
export function checkCaptureOptions(options: CaptureOptions, scene: readonly string[]): void {
  const { legend, layers, sheet, against } = options;

  if (sheet !== undefined && (legend === true || against !== undefined)) throw sheetAlone();

  if (layers?.length === 0) {
    throw new Error(
      "[game] game.capture takes at least one layer.\n  Pass the layer names to draw, or leave layers out."
    );
  }

  const missing = layers?.find(name => !scene.includes(name));

  if (missing !== undefined) throw layerMissing(missing, scene);

  if (sheet !== undefined && !sheetInRange(sheet)) {
    throw new Error(
      "[game] game.capture takes a sheet of 2 to 12 frames, every 1 to 5000 ms.\n  Pass { frames, everyMs } in that range."
    );
  }
}

/**
 * Tells whether a view of a layer is drawn when only some layers are.
 *
 * @param layers - The layers drawn; every layer when `undefined`.
 * @param layer - The layer of the view, or `undefined` when it names none.
 * @returns True when the view is in the picture.
 * @example
 * ```ts
 * drawnIn(["hud"], "board"); // false
 * ```
 */
function drawnIn(layers: readonly string[] | undefined, layer: string | undefined): boolean {
  return layers === undefined || (layer !== undefined && layers.includes(layer));
}

/**
 * The layer names of the scene.
 *
 * @param mctx - Domain context of the capture.
 * @returns The names, in draw order.
 */
function sceneLayers(mctx: MonitorCtx): string[] {
  return mctx.ctx.deps.world.projection.layers().map(spec => spec.name);
}

/**
 * The layer containers a picture of some layers leaves out.
 *
 * @param mctx - Domain context of the capture.
 * @param layers - The layers drawn; every layer when `undefined`.
 * @returns The containers of the other layers.
 */
function hiddenLayers(mctx: MonitorCtx, layers: readonly string[] | undefined): PixiContainer[] {
  const hidden: PixiContainer[] = [];

  if (layers === undefined) return hidden;

  for (const name of sceneLayers(mctx)) {
    const container = layers.includes(name) ? undefined : mctx.deps.sync.layerContainer(name);

    if (container !== undefined) hidden.push(container);
  }

  return hidden;
}

/**
 * Where the canvas is on the page, so a rect of the viewport becomes a rect of the picture.
 *
 * @param canvas - The canvas of the application.
 * @returns Its top-left corner in CSS pixels; the origin when there is no canvas.
 */
function canvasOrigin(canvas: HTMLCanvasElement | undefined): Point {
  const rect = canvas?.getBoundingClientRect();

  return { x: rect?.left ?? 0, y: rect?.top ?? 0 };
}

/**
 * Measures the legend of the frame just drawn: every entity of the world with a projection
 * address and visible bounds, in a layer drawn, placed on the picture and numbered.
 *
 * @param mctx - Domain context of the capture.
 * @param layers - The layers drawn; every layer when `undefined`.
 * @returns The numbered entries.
 */
function measureLegend(mctx: MonitorCtx, layers: readonly string[] | undefined): LegendEntry[] {
  const world = mctx.ctx.deps.world;
  const { host, viewport, sync } = mctx.deps;
  const origin = canvasOrigin(host.canvas());
  const resolution = host.resolution();
  const found: Array<Omit<LegendEntry, "n">> = [];

  for (const { id } of world.ecs.snapshot().entities) {
    const address = world.projection.keyOf(id);
    const box = address === undefined ? undefined : sync.boundsOf(id);

    if (address === undefined || box === undefined || !drawnIn(layers, sync.layerOf(id))) continue;

    found.push({
      projection: address.projection,
      key: address.key,
      rect: pictureRect(box, viewport.toScreen, origin, resolution)
    });
  }

  return numberLegend(found);
}

/**
 * Takes the picture of the frame just drawn. The legend and the extract's render happen now,
 * synchronously, so both show this frame; only the encoding of the PNG comes later.
 *
 * @param mctx - Domain context of the capture.
 * @param take - The layers drawn and whether the legend is measured.
 * @returns The shot, or `undefined` when Pixi could not read the frame.
 */
async function takeShot(mctx: MonitorCtx, take: Take): Promise<Shot | undefined> {
  const legend = take.legend ? measureLegend(mctx, take.layers) : undefined;
  const elapsed = mctx.ctx.deps.time.snapshot().elapsed;
  const png = await mctx.deps.host.extract(hiddenLayers(mctx, take.layers));

  return png === undefined ? undefined : { png, legend, elapsed };
}

/**
 * Queues a picture for the end of the first drawn frame `due` accepts.
 *
 * @param mctx - Domain context of the capture.
 * @param take - The layers drawn and whether the legend is measured.
 * @param due - True when the frame just drawn is the one to take.
 * @param whilePaused - Takes the shot instead when the game pauses before that frame came.
 * @returns The shot, once that frame was drawn.
 */
function queueShot(
  mctx: MonitorCtx,
  take: Take,
  due: () => boolean,
  whilePaused: () => Promise<Shot | undefined>
): Promise<Shot | undefined> {
  return new Promise((resolve, reject) => {
    mctx.ctx.state.monitor.captures.push({ ...take, due, whilePaused, waited: 0, resolve, reject });
  });
}

/**
 * The picture of the next drawn frame; at once while the clock is paused, since no frame comes.
 *
 * @param mctx - Domain context of the capture.
 * @param take - The layers drawn and whether the legend is measured.
 * @returns The shot.
 */
function nextShot(mctx: MonitorCtx, take: Take): Promise<Shot | undefined> {
  const now = (): Promise<Shot | undefined> => takeShot(mctx, take);

  if (mctx.ctx.deps.time.isPaused()) return now();

  return queueShot(mctx, take, () => true, now);
}

/**
 * Steps the clock by some game time, the way `game.step` does, and takes the frame it drew.
 * Async, so a throwing step rejects the shot instead of throwing at the caller.
 *
 * @param mctx - Domain context of the capture.
 * @param take - The layers drawn and whether the legend is measured.
 * @param stepMs - The game time to step, in milliseconds.
 * @returns The shot.
 */
async function steppedShot(
  mctx: MonitorCtx,
  take: Take,
  stepMs: number
): Promise<Shot | undefined> {
  mctx.ctx.log.debug("moku:dev", { command: "renderer.capture", step: stepMs });
  mctx.ctx.deps.time.step(stepMs);

  return takeShot(mctx, take);
}

/**
 * The next frame of a sheet, `everyMs` of game time after the last one. A paused clock is stepped
 * by `everyMs` once; a running one is waited for, and stepped by what is left of `everyMs` when
 * the game pauses first, by nothing when an earlier capture stepped the clock past it.
 *
 * @param mctx - Domain context of the capture.
 * @param layers - The layers drawn.
 * @param everyMs - The spacing of the sheet.
 * @param since - The game time of the last frame.
 * @returns The shot.
 */
function laterShot(
  mctx: MonitorCtx,
  layers: readonly string[] | undefined,
  everyMs: number,
  since: number
): Promise<Shot | undefined> {
  const time = mctx.ctx.deps.time;
  const take: Take = { layers, legend: false };

  if (time.isPaused()) return steppedShot(mctx, take, everyMs);

  return queueShot(
    mctx,
    take,
    () => time.snapshot().elapsed - since >= everyMs,
    // Never back: an earlier sheet served on the same pause may have stepped past this one.
    () => steppedShot(mctx, take, Math.max(0, since + everyMs - time.snapshot().elapsed))
  );
}

/**
 * A cache for one drawn frame: the captures due on it with the same layers and legend share one
 * shot, so one frame costs one extract per kind of picture.
 *
 * @param mctx - Domain context of the capture.
 * @returns Takes the shot of a kind, or hands back the one taken already.
 */
function shotsOfFrame(mctx: MonitorCtx): (take: Take) => Promise<Shot | undefined> {
  const taken = new Map<string, Promise<Shot | undefined>>();

  return (take: Take): Promise<Shot | undefined> => {
    const kind = `${String(take.legend)} ${JSON.stringify(take.layers ?? [])}`;
    const shot = taken.get(kind) ?? takeShot(mctx, take);

    taken.set(kind, shot);

    return shot;
  };
}

/**
 * Keeps a capture waiting for a later frame, until it waited 600 drawn frames.
 *
 * @param state - The monitor branch of the plugin state.
 * @param request - The capture whose frame has not come.
 */
function waitOn(state: MonitorState, request: PictureRequest): void {
  request.waited += 1;

  if (request.waited >= MAX_WAIT_FRAMES) {
    request.reject(timeStood());

    return;
  }

  state.captures.push(request);
}

/**
 * Hands the frame just drawn to the captures waiting for it. Called at the end of every drawn
 * frame.
 *
 * @param mctx - Domain context of the capture.
 */
export function serveCaptures(mctx: MonitorCtx): void {
  const state = mctx.ctx.state.monitor;

  if (state.captures.length === 0) return;

  const waiting = state.captures.splice(0);
  const shots = shotsOfFrame(mctx);

  for (const request of waiting) {
    if (request.due()) {
      shots(request).then(request.resolve, request.reject);
    } else {
      waitOn(state, request);
    }
  }
}

/**
 * Serves the captures still waiting when the game pauses, since no frame comes to serve them: each
 * takes its paused path, a plain capture at once and a sheet with `time.step`. It runs one
 * microtask later, so a pause inside a frame lets that frame end first, as `time.step` throws
 * inside one; a clock that runs again by then leaves them waiting for its next frame.
 *
 * @param state - The monitor branch of the plugin state.
 * @param time - The time API, asked whether the clock is still paused.
 */
export function servePaused(state: MonitorState, time: TimeApi): void {
  queueMicrotask(() => {
    if (!time.isPaused()) return;

    for (const request of state.captures.splice(0)) {
      request.whilePaused().then(request.resolve, request.reject);
    }
  });
}

/**
 * Answers every capture still waiting with `undefined`. Works on the state alone, for `onStop`.
 *
 * @param state - The monitor branch of the plugin state.
 */
export function cancelCaptures(state: MonitorState): void {
  for (const request of state.captures.splice(0)) request.resolve();
}

/**
 * Takes the frames of a contact sheet and lays them out.
 *
 * @param mctx - Domain context of the capture.
 * @param layers - The layers drawn.
 * @param sheet - How many frames, how far apart.
 * @returns `{ png }` of the sheet, or `undefined` when a frame could not be read.
 */
async function captureSheet(
  mctx: MonitorCtx,
  layers: readonly string[] | undefined,
  sheet: Sheet
): Promise<Captured | undefined> {
  const first = await nextShot(mctx, { layers, legend: false });

  if (first === undefined) return undefined;

  const pictures: [string, ...string[]] = [first.png];
  let since = first.elapsed;

  while (pictures.length < sheet.frames) {
    const shot = await laterShot(mctx, layers, sheet.everyMs, since);

    if (shot === undefined) return undefined;

    pictures.push(shot.png);
    since = shot.elapsed;
  }

  return { png: await sheetPicture(pictures, mctx.deps.host.resolution()) };
}

/**
 * Draws the answer of one picture: the diff when there is an earlier picture, the badges when
 * there is a legend, the picture itself otherwise.
 *
 * @param mctx - Domain context of the capture.
 * @param shot - The picture and its legend.
 * @param against - The earlier picture, or `undefined`.
 * @returns The answer.
 */
async function answerOf(
  mctx: MonitorCtx,
  shot: Shot,
  against: string | undefined
): Promise<Captured> {
  const { legend } = shot;
  const resolution = mctx.deps.host.resolution();

  if (against !== undefined) {
    const png = await diffPicture(shot.png, against, legend, resolution);

    return legend === undefined ? { png } : { png, legend };
  }

  if (legend === undefined) return { png: shot.png };

  return { png: await legendPicture(shot.png, legend, resolution), legend };
}

/**
 * Captures the canvas with its options, after the dev guard of `capture()`.
 *
 * @param mctx - Domain context of the capture.
 * @param options - The options of `capture()`.
 * @returns The answer, or `undefined` while nothing draws and when Pixi could not read a frame.
 * @throws {Error} When an option is refused, or there is no `OffscreenCanvas` for one.
 */
export async function captureFrame(
  mctx: MonitorCtx,
  options: CaptureOptions
): Promise<Captured | undefined> {
  checkCaptureOptions(options, sceneLayers(mctx));

  if (!mctx.deps.host.ready()) return undefined;

  const given = givenOptions(options);

  if (given[0] !== undefined && typeof OffscreenCanvas === "undefined") {
    throw needsCanvas(given[0]);
  }

  mctx.ctx.log.debug(
    "moku:dev",
    given.length === 0
      ? { command: "renderer.capture" }
      : { command: "renderer.capture", options: given }
  );

  if (options.sheet !== undefined) return captureSheet(mctx, options.layers, options.sheet);

  const shot = await nextShot(mctx, { layers: options.layers, legend: options.legend === true });

  return shot === undefined ? undefined : answerOf(mctx, shot, options.against);
}
