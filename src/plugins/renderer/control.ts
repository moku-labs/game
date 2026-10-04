/**
 * @file renderer plugin — the renderer commands of the `/control` door: take a picture of the
 * canvas, with its options, and switch the debug drawing. Dev builds only: every body starts with
 * the inline dev guard, so a bundler `define` of `false` drops it, and logs the `moku:dev` marker.
 */
import { defineCommand } from "../flow/doors/define";
import { controlRefused } from "../flow/doors/dev";
import { recordCheat } from "../flow/doors/session";
import type { ControlApp } from "../flow/doors/types";
import type { HeadlessApp } from "../flow/headless";
import { readBookmark } from "../flow/json";
import type { Bookmark, FlowState } from "../flow/types";
import type { Json } from "../model/types";
import type { Api as WorldApi } from "../world/types";
import { sheetAlone } from "./monitor/capture";
import type { Api, Captured, CaptureOptions } from "./types";

/** What the renderer commands need of an app: the control app plus the renderer. */
type RendererApp = ControlApp & { readonly renderer: Api };

/** What `game.capture` needs of an app: the renderer app plus the world the renderer draws. */
type CaptureApp = RendererApp & { readonly world: WorldApi };

/** The input of `game.capture` as the door hands it over: every field is optional JSON. */
type CaptureInput = {
  legend?: boolean | undefined;
  layers?: Json | undefined;
  sheet?: Json | undefined;
  diff?: Json | undefined;
};

/** The input fields of `game.capture`, in the order its `moku:dev` entry lists them. */
const CAPTURE_FIELDS = ["legend", "layers", "sheet", "diff"] as const;

/** Drawn frames a restored bookmark gets to come to rest at its gate. */
const REST_FRAMES = 600;

/** Drawn frames after the rest, so the screen the gate opened is built and drawn. */
const AFTER_REST_FRAMES = 2;

/**
 * Builds the error of an input field of `game.capture` with the wrong shape.
 *
 * @param field - The field.
 * @param expected - What to pass instead.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * wrongShape("sheet", "{ frames, everyMs }, two numbers").message;
 * // "[game] game.capture: sheet has the wrong shape.\n  Pass { frames, everyMs }, two numbers."
 * ```
 */
function wrongShape(field: string, expected: string): Error {
  return new Error(`[game] game.capture: ${field} has the wrong shape.\n  Pass ${expected}.`);
}

/**
 * Reads the `layers` field: a JSON array of strings.
 *
 * @param value - The JSON the editor sent.
 * @returns The layer names.
 * @throws {Error} When it is not an array of strings.
 * @example
 * ```ts
 * readLayers(["board", "hud"]); // ["board", "hud"]
 * ```
 */
function readLayers(value: Json): readonly string[] {
  if (Array.isArray(value) && value.every((name): name is string => typeof name === "string")) {
    return value;
  }

  throw wrongShape("layers", 'an array of layer names, such as ["board", "hud"]');
}

/**
 * Reads the `sheet` field: an object of two numbers, `frames` and `everyMs`. Their range is
 * checked by `renderer.capture()`.
 *
 * @param value - The JSON the editor sent.
 * @returns The sheet.
 * @throws {Error} When it is not an object with two numbers.
 * @example
 * ```ts
 * readSheet({ frames: 6, everyMs: 100 }); // { frames: 6, everyMs: 100 }
 * ```
 */
function readSheet(value: Json): { frames: number; everyMs: number } {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const { frames, everyMs } = value;

    if (typeof frames === "number" && typeof everyMs === "number") return { frames, everyMs };
  }

  throw wrongShape("sheet", "{ frames, everyMs }, two numbers");
}

/**
 * Reads the `diff` field: a bookmark, the value `game.bookmark` answered.
 *
 * @param value - The JSON the editor sent.
 * @returns The bookmark.
 * @throws {Error} When it is not a bookmark.
 */
function readDiff(value: Json): Bookmark {
  try {
    return readBookmark(value);
  } catch {
    throw wrongShape("diff", "a bookmark, the value of game.bookmark");
  }
}

/**
 * Reads the options `game.capture` passes to `renderer.capture()` as they are: only the fields
 * given.
 *
 * @param input - The input of the command.
 * @returns The options.
 * @throws {Error} When `layers` or `sheet` has the wrong shape.
 */
function readOptions(input: CaptureInput): CaptureOptions {
  const options: CaptureOptions = {};

  if (input.legend !== undefined) options.legend = input.legend;
  if (input.layers !== undefined) options.layers = readLayers(input.layers);
  if (input.sheet !== undefined) options.sheet = readSheet(input.sheet);

  return options;
}

/**
 * The input fields given: `legend` when true, the others when present.
 *
 * @param input - The input of the command.
 * @returns Their names.
 * @example
 * ```ts
 * givenFields({ legend: true, diff: { path: "home" } }); // ["legend", "diff"]
 * ```
 */
function givenFields(input: CaptureInput): string[] {
  return CAPTURE_FIELDS.filter(field =>
    field === "legend" ? input.legend === true : input[field] !== undefined
  );
}

/**
 * Tells whether the graph waits at a gate with no effect pending.
 *
 * @param state - The flow state.
 * @returns True at rest.
 * @example
 * ```ts
 * atRest({ running: true, path: "home", stack: [], pending: { gate: ["play"] }, mode: "live" }); // true
 * ```
 */
function atRest(state: FlowState): boolean {
  return state.pending.gate !== undefined && state.pending.fx === undefined;
}

/**
 * Waits for the next drawn frame: the end of its `render` phase.
 *
 * @param app - The app whose frames are waited on.
 * @returns Resolves after that frame.
 */
function nextFrame(app: HeadlessApp): Promise<void> {
  return new Promise(resolve => {
    const off = app.time.onFrame("render", () => {
      off();
      resolve();
    });
  });
}

/**
 * Waits on drawn frames until the graph rests at a gate: at most 600.
 *
 * @param app - The app.
 * @returns True once it rests, false when it still does not after 600 drawn frames.
 */
async function waitForRest(app: HeadlessApp): Promise<boolean> {
  for (let frame = 0; frame < REST_FRAMES; frame += 1) {
    if (atRest(app.flow.state())) return true;

    await nextFrame(app);
  }

  return atRest(app.flow.state());
}

/**
 * Restores a bookmark and waits until the graph rests at a gate, then two drawn frames more, so
 * the screen of the gate is built and drawn.
 *
 * @param app - The app.
 * @param bookmark - The bookmark to enter.
 * @throws {Error} When the graph does not rest within 600 drawn frames.
 */
async function restoreAtRest(app: HeadlessApp, bookmark: Bookmark): Promise<void> {
  await app.flow.restore(bookmark);

  if (!(await waitForRest(app))) {
    throw new Error(
      "[game] game.capture diff: the bookmark did not come to rest in 600 frames.\n  Capture a bookmark taken at a gate."
    );
  }

  for (let frame = 0; frame < AFTER_REST_FRAMES; frame += 1) await nextFrame(app);
}

/**
 * Runs work in the state of a bookmark and comes back to where the game stood, also when the
 * work or the restore fails.
 *
 * @param app - The app.
 * @param bookmark - The bookmark to visit.
 * @param work - What to do there.
 * @returns What the work answered.
 * @throws {Error} When a restore does not come to rest, and whatever the work throws.
 */
async function atBookmark<T>(
  app: HeadlessApp,
  bookmark: Bookmark,
  work: () => Promise<T>
): Promise<T> {
  const before = app.flow.bookmark();

  try {
    await restoreAtRest(app, bookmark);

    return await work();
  } finally {
    await restoreAtRest(app, before);
  }
}

/**
 * The diff of `game.capture`: the picture of the bookmark, taken in its state, and the picture of
 * now drawn against it. The command journals itself first, since it replaces the state twice.
 *
 * @param app - The app.
 * @param options - The options passed on: `layers` to both pictures, `legend` to the second.
 * @param diff - The bookmark to compare with.
 * @param raw - The bookmark as the editor sent it, for the journal.
 * @returns The diff picture, or `undefined` while the renderer is inert.
 * @throws {Error} When the graph is not at rest, and when a restore does not come to rest.
 */
async function captureDiff(
  app: CaptureApp,
  options: CaptureOptions,
  diff: Bookmark,
  raw: Json
): Promise<Captured | undefined> {
  // Nothing to compare while nothing draws: the state is left alone.
  if (!app.renderer.host.ready()) return undefined;

  if (!atRest(app.flow.state())) {
    throw new Error(
      "[game] game.capture diff needs the game at rest.\n  Wait for the gate, then capture."
    );
  }

  recordCheat(app, "game.capture", { diff: raw }, app.time.snapshot().frame);

  const layers: CaptureOptions = options.layers === undefined ? {} : { layers: options.layers };
  const theirs = await atBookmark(app, diff, () => app.renderer.capture(layers));

  return theirs === undefined
    ? undefined
    : app.renderer.capture({ ...options, against: theirs.png });
}

/**
 * A picture of the whole canvas taken at the end of the next drawn frame: `{ png }`, and
 * `{ png, legend }` with `legend: true`. `legend`, `layers` and `sheet` go to `renderer.capture()`
 * as they are. `diff`, a bookmark, is the one option the command runs itself: at rest, it journals
 * itself as a raw write (`tainted` turns true), restores the bookmark and waits for its gate, takes
 * that picture, restores where the game stood and waits again, and answers the pixel diff of now
 * against then. `undefined` while the renderer is inert, as in a headless test.
 *
 * @example
 * ```ts
 * // The editor attaches the numbered screen to a bug report.
 * (await run(app, commands.capture, { legend: true })).value;
 * // { png: "data:image/png;base64,…", legend: [{ n: 1, projection: "hud", key: "claim", rect: { x: 1140, y: 2310, w: 567, h: 164 } }] }
 * // What changed since the start of the level: red where the pixels differ.
 * (await run(app, commands.capture, { diff: levelStart })).value; // { png: "data:image/png;base64,…" }
 * ```
 */
export const captureCommand = defineCommand({
  id: "game.capture",
  title: "Capture",
  input: { legend: "boolean?", layers: "json?", sheet: "json?", diff: "json?" },
  effect: "read",
  run: (app: CaptureApp, input) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    const given = givenFields(input);

    app.log.debug(
      "moku:dev",
      given.length === 0 ? { command: "game.capture" } : { command: "game.capture", options: given }
    );

    const options = readOptions(input);

    if (input.diff === undefined) return app.renderer.capture(options);

    const diff = readDiff(input.diff);

    if (options.sheet !== undefined) throw sheetAlone();

    return captureDiff(app, options, diff, input.diff);
  }
});

/**
 * Switches the debug drawing: `nineSlice` outlines every nine-slice and the lines Pixi cuts its
 * texture at. Answers the switches as they are afterwards.
 *
 * @example
 * ```ts
 * // Check where the settings popup cuts its parchment.
 * (await run(app, commands.debug, { nineSlice: true })).value; // { nineSlice: true }
 * ```
 */
export const debugCommand = defineCommand({
  id: "game.debug",
  title: "Debug drawing",
  input: { nineSlice: "boolean" },
  effect: "cosmetic",
  run: (app: RendererApp, { nineSlice }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.debug", nineSlice });
    app.renderer.sync.debug.nineSlice(nineSlice);

    return app.renderer.sync.debug.state();
  }
});
