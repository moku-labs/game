/**
 * @file visual — the page script of the browser leg: plain functions that run inside the dev page.
 * They read only `globalThis.game`, `globalThis.doors` and what the browser offers, and they call
 * only each other: Playwright serialises the one function a call names and runs it in the page,
 * and `pageScript()` installs all of them there first, so the others are found by name. Nothing
 * in them may reach the scope of this module. Every function the leg calls answers instead of
 * throwing, so a failure comes back as a message and not as Playwright's own error.
 *
 * Game time is the leg's: once a test holds the pause, only the `step` command moves it, one frame
 * of 1000/60 ms at a time, and the browser's frames only let a load and a promise chain progress.
 * Two runs of a test see the same game time, so time-driven pixels are the same. The pictures
 * leave the page as lossless WebP.
 */
import type { commands } from "../plugins/flow/doors/commands";
import type { read } from "../plugins/flow/doors/read";
import type { run } from "../plugins/flow/doors/run";
import type { sources } from "../plugins/flow/doors/sources";
import type { RendererKind } from "../plugins/renderer/types";
import type { StepInput, StepRunner } from "./steps";
import type { StepCommand, VisualApp, VisualState } from "./types";

/** The doors the dev page exposes as `globalThis.doors`, the way the fixture's `web/main.ts` does. */
type PageDoors = {
  read: typeof read;
  sources: typeof sources;
  run: typeof run;
  commands: typeof commands;
};

/** The two handles of the page contract. */
type PageHandles = { game: VisualApp; doors: PageDoors };

/** Which test and which step a page call runs for, so a message can name them. */
type Place = { test: string; where: string };

/**
 * What a page function answers: its value, or why it failed. `error` is the whole message of the
 * failure; `reason` is what went wrong, and the leg names the test and the step around it.
 */
export type PageAnswer<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }
  | { ok: false; reason: string };

/** A picture as RGBA bytes, the way `ImageData` holds it. */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };

/**
 * What `comparePixels` found: whether the sizes match, how many pixels differ out of how many,
 * and the diff picture, red where a pixel differs over the baseline faded towards white.
 */
export type PixelDiff = {
  sameSize: boolean;
  differing: number;
  total: number;
  diff: Uint8ClampedArray<ArrayBuffer>;
};

/**
 * What `pageCompare` answers: the counts, and the diff picture as a lossless WebP data URL when
 * one differs.
 */
export type PageCompared = { sameSize: boolean; differing: number; total: number; diff?: string };

/**
 * What the page saw at a checkpoint: the state through the doors and the picture of the canvas as
 * a lossless WebP data URL.
 */
export type PageShot = { state: VisualState; screen: string | undefined };

/**
 * Tells whether the dev page exposes both handles yet. The leg waits on it after `goto`.
 *
 * @returns True once `globalThis.game` and `globalThis.doors` are set.
 */
export function pageReady(): boolean {
  return (
    Reflect.get(globalThis, "game") !== undefined && Reflect.get(globalThis, "doors") !== undefined
  );
}

/**
 * Tells the game of the page contract from any other value: an object with a graph, motions and
 * a renderer.
 *
 * @param value - What `globalThis.game` holds.
 * @returns True for the app the dev page set.
 */
function isPageGame(value: unknown): value is VisualApp {
  return (
    typeof value === "object" &&
    value !== null &&
    "flow" in value &&
    "anim" in value &&
    "renderer" in value
  );
}

/**
 * Tells the doors of the page contract from any other value.
 *
 * @param value - What `globalThis.doors` holds.
 * @returns True for an object with `read`, `run`, `sources` and `commands`.
 */
function isPageDoors(value: unknown): value is PageDoors {
  return (
    typeof value === "object" &&
    value !== null &&
    "read" in value &&
    "run" in value &&
    "sources" in value &&
    "commands" in value
  );
}

/**
 * Reads the two handles of the page contract.
 *
 * @returns The game and the doors.
 * @throws {Error} When the page set either of them to something else, or not at all.
 */
function pageHandles(): PageHandles {
  const game: unknown = Reflect.get(globalThis, "game");
  const doors: unknown = Reflect.get(globalThis, "doors");

  if (isPageGame(game) && isPageDoors(doors)) return { game, doors };

  throw new Error(
    "[game] The page exposes no game and doors.\n  Set globalThis.game and globalThis.doors in the dev page."
  );
}

/**
 * Waits for the next frame of the browser. It moves no game time while the leg holds the pause.
 *
 * @returns A promise that settles in the next `requestAnimationFrame`.
 */
function pageFrame(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Yields the task queue once, so every promise chain that can move does.
 *
 * @returns A promise that settles in the next task.
 */
function pageTask(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

/**
 * Reads the message of whatever a page call threw.
 *
 * @param error - What was thrown.
 * @returns The message of an error, the value as text otherwise.
 * @example
 * ```ts
 * pageMessage(new Error("The source image could not be decoded.")); // "The source image could not be decoded."
 * ```
 */
function pageMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one frame of the game through the `step` command: the six phases, the render included,
 * also while the game is paused.
 *
 * @param handles - The game and the doors.
 * @param deltaMs - The game time of the frame: 1000/60 ms, the frame of the headless leg.
 */
async function pageStepFrame(handles: PageHandles, deltaMs = 1000 / 60): Promise<void> {
  await handles.doors.run(handles.game, handles.doors.commands.step, { frames: 1, deltaMs });
}

/**
 * Runs one frame of a test: a stepped frame of 1000/60 ms, then the browser's next frame, so a
 * load and a promise chain progress before the graph is read.
 *
 * @param handles - The game and the doors.
 */
async function pageTick(handles: PageHandles): Promise<void> {
  await pageStepFrame(handles);
  await pageFrame();
}

/**
 * Runs frames until the graph rests at a gate or stops: at least one frame, at most `limit`, then
 * one frame more so the ui of a screen the gate opened is built. The settle of the headless leg,
 * on the same stepped frames.
 *
 * @param handles - The game and the doors.
 * @param limit - The most frames to run, `settleFrames` of the run.
 * @param place - The test and the step, for the message.
 * @returns The error message when the graph did not rest, `undefined` when it did.
 */
async function pageSettle(
  handles: PageHandles,
  limit: number,
  place: Place
): Promise<string | undefined> {
  const { game } = handles;

  for (let frame = 0; frame < limit; frame += 1) {
    await pageTick(handles);

    const state = game.flow.state();

    if (state.pending.gate !== undefined || !state.running) {
      await pageTick(handles);

      return undefined;
    }
  }

  return `[game] Visual test "${place.test}", ${place.where} did not settle in ${limit} frames.\n  The graph stands at "${game.flow.state().path}"; add a step that answers what it waits for.`;
}

/**
 * Runs one `/control` command through the doors, the way an editor does, and runs frames while it
 * waits for them: a `restore` resolves only once the graph rests, and that takes frames. A
 * command that waits for no frame is done before the first one.
 *
 * @param handles - The game and the doors.
 * @param command - The command by its short name, and its input.
 * @param command.name - The short name of the command.
 * @param command.input - Its input.
 * @param limit - The most frames to run, `settleFrames` of the run.
 * @param place - The test and the step, for the message.
 * @returns The error message when the command did not finish, `undefined` when it did.
 * @throws {unknown} Whatever the command threw.
 */
async function pageRun(
  handles: PageHandles,
  command: { name: StepCommand; input: StepInput },
  limit: number,
  place: Place
): Promise<string | undefined> {
  const { game, doors } = handles;
  const runners: Readonly<Record<StepCommand, StepRunner>> = doors.commands;
  const ran: { done: boolean; failure: { error: unknown } | undefined } = {
    done: false,
    failure: undefined
  };
  const finished = doors.run(game, runners[command.name], command.input).then(
    () => {
      ran.done = true;
    },
    (error: unknown) => {
      ran.done = true;
      ran.failure = { error };
    }
  );
  let frames = 0;

  await pageTask();

  while (!ran.done) {
    if (frames === limit) {
      return `[game] Visual test "${place.test}", ${place.where} did not finish in ${limit} frames.\n  The graph stands at "${game.flow.state().path}"; the command waits for something the stepped frames never bring.`;
    }

    await pageTick(handles);
    frames += 1;
  }

  await finished;

  if (ran.failure !== undefined) throw ran.failure.error;

  return undefined;
}

/**
 * Waits until the page's own graph runs and rests at a gate, the way the dev page starts it, and
 * reads the backend the renderer chose. The game runs on the browser's frames here: the leg
 * pauses it later, before the start of a test.
 *
 * @param argument - The page URL, for the message, and the most frames to wait.
 * @param argument.url - The URL of the dev page.
 * @param argument.settleFrames - The most frames to wait.
 * @returns The renderer kind, or why the page did not start.
 */
export async function pageStart(argument: {
  url: string;
  settleFrames: number;
}): Promise<PageAnswer<RendererKind>> {
  try {
    const { game } = pageHandles();

    for (let frame = 0; frame < argument.settleFrames; frame += 1) {
      const state = game.flow.state();

      if (state.running && state.pending.gate !== undefined) {
        return { ok: true, value: game.renderer.host.kind() };
      }

      await pageFrame();
    }

    return {
      ok: false,
      error: `[game] The page at ${argument.url} did not rest at a gate in ${argument.settleFrames} frames.\n  The graph stands at "${game.flow.state().path}"; start the app and run its graph in the dev page.`
    };
  } catch (error) {
    return { ok: false, reason: pageMessage(error) };
  }
}

/**
 * Holds the game for a test: the `pause` command, the editor's pause, so the browser's frames no
 * longer move game time; then stepped frames up to the start time, 1000/60 ms each and the last
 * one shorter, so the game lands on it to the last bit. The page's own start took a different
 * time on every run; from here on every test starts at the same game time.
 *
 * @param argument - The test and the step, and the game time a test starts at.
 * @param argument.startMs - The game time a test starts at, in milliseconds; a page whose clock
 *   is already past it starts at the next multiple of it.
 * @returns The game time the test starts at, or why the page refused the pause.
 */
export async function pagePause(
  argument: Place & { startMs: number }
): Promise<PageAnswer<number>> {
  try {
    const handles = pageHandles();
    const { game, doors } = handles;
    const { startMs } = argument;

    await doors.run(game, doors.commands.pause);

    const start = Math.max(startMs, Math.ceil(game.time.snapshot().elapsed / startMs) * startMs);

    for (
      let left = start - game.time.snapshot().elapsed;
      left > 0;
      left = start - game.time.snapshot().elapsed
    ) {
      await pageStepFrame(handles, Math.min(left, 1000 / 60));
    }

    return { ok: true, value: game.time.snapshot().elapsed };
  } catch (error) {
    return { ok: false, reason: pageMessage(error) };
  }
}

/**
 * Runs one `/control` command through the doors of the page, the way an editor does, with frames
 * stepped while it waits for them, then settles. The leg restores the start of a test with it
 * too, as the command `restore`.
 *
 * @param argument - The test and the step, the command by its short name, its input, and the most
 *   frames to settle.
 * @param argument.name - The short name of the command.
 * @param argument.input - Its input.
 * @param argument.settleFrames - The most frames to settle.
 * @returns Nothing, or why the command or the settle failed.
 */
export async function pageStep(
  argument: Place & { name: StepCommand; input: StepInput; settleFrames: number }
): Promise<PageAnswer<undefined>> {
  try {
    const handles = pageHandles();
    const unfinished = await pageRun(handles, argument, argument.settleFrames, argument);
    const unsettled = unfinished ?? (await pageSettle(handles, argument.settleFrames, argument));

    return unsettled === undefined
      ? { ok: true, value: undefined }
      : { ok: false, error: unsettled };
  } catch (error) {
    return { ok: false, reason: pageMessage(error) };
  }
}

/**
 * Plays a checkpoint in the page: settle, land every track and loop, two stepped frames, then the
 * picture of the whole canvas as lossless WebP and the state through the doors. The game is
 * paused, so the picture is the stage after the last stepped frame.
 *
 * @param argument - The test and the step, and the most frames to settle.
 * @param argument.settleFrames - The most frames to settle.
 * @returns The state and the picture, or why the checkpoint failed.
 */
export async function pageCheckpoint(
  argument: Place & { settleFrames: number }
): Promise<PageAnswer<PageShot>> {
  try {
    const handles = pageHandles();
    const { game, doors } = handles;
    const unsettled = await pageSettle(handles, argument.settleFrames, argument);

    if (unsettled !== undefined) return { ok: false, error: unsettled };

    game.anim.finishAll();
    await pageTick(handles);
    await pageTick(handles);

    const captured = await game.renderer.capture();
    const screen = captured === undefined ? undefined : await pageWebp(captured);
    const state = {
      path: doors.read(game, doors.sources.position).path,
      ...doors.read(game, doors.sources.model)
    };

    return { ok: true, value: { state, screen } };
  } catch (error) {
    return { ok: false, reason: pageMessage(error) };
  }
}

/**
 * Measures how far apart two pixels are: the largest delta of their four channels.
 *
 * @param expected - The bytes of the baseline.
 * @param actual - The bytes of the capture.
 * @param at - The index of the pixel's first byte.
 * @returns The largest channel delta, from 0 to 255.
 * @example
 * ```ts
 * channelDelta(new Uint8ClampedArray([10, 20, 30, 255]), new Uint8ClampedArray([12, 20, 0, 255]), 0); // 30
 * ```
 */
function channelDelta(expected: Uint8ClampedArray, actual: Uint8ClampedArray, at: number): number {
  let delta = 0;

  for (let channel = at; channel < at + 4; channel += 1) {
    delta = Math.max(delta, Math.abs((expected[channel] ?? 0) - (actual[channel] ?? 0)));
  }

  return delta;
}

/**
 * Compares two pictures pixel by pixel. A pixel differs when the largest delta of its channels
 * exceeds `threshold`. The diff picture is red where a pixel differs and the baseline faded
 * three quarters towards white elsewhere. Two sizes are not compared.
 *
 * @param expected - The baseline.
 * @param actual - The capture.
 * @param threshold - The largest channel delta that still counts as the same pixel.
 * @returns The counts and the diff picture.
 * @example
 * ```ts
 * const black = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
 * comparePixels(black, { ...black, data: new Uint8ClampedArray([30, 0, 0, 255]) }, 24).differing; // 1
 * ```
 */
export function comparePixels(expected: Pixels, actual: Pixels, threshold: number): PixelDiff {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { sameSize: false, differing: 0, total: 0, diff: new Uint8ClampedArray(0) };
  }

  const total = expected.width * expected.height;
  const diff = new Uint8ClampedArray(total * 4);
  let differing = 0;

  for (let at = 0; at < diff.length; at += 4) {
    if (channelDelta(expected.data, actual.data, at) > threshold) {
      differing += 1;
      diff.set([255, 0, 0, 255], at);
      continue;
    }

    for (let channel = at; channel < at + 3; channel += 1) {
      diff[channel] = ((expected.data[channel] ?? 0) + 765) / 4;
    }

    diff[at + 3] = 255;
  }

  return { sameSize: true, differing, total, diff };
}

/**
 * Gets a 2D context of an `OffscreenCanvas`, the one canvas the compare draws on.
 *
 * @param width - Pixels across.
 * @param height - Pixels down.
 * @returns The canvas and its context.
 * @throws {Error} When the browser gives no 2D context.
 */
function pageCanvas(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (context === null) {
    throw new Error("The browser gave no 2D context for an OffscreenCanvas.");
  }

  return { canvas, context };
}

/**
 * Decodes a PNG or WebP data URL into its pixels, with no colour conversion.
 *
 * @param url - The data URL.
 * @returns The pixels.
 */
async function pageDecode(url: string): Promise<Pixels> {
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none"
  });
  const { context } = pageCanvas(bitmap.width, bitmap.height);

  context.drawImage(bitmap, 0, 0);

  const image = context.getImageData(0, 0, bitmap.width, bitmap.height);

  return { width: image.width, height: image.height, data: image.data };
}

/**
 * Encodes pixels as a lossless WebP data URL: Chrome encodes WebP at quality 1 losslessly, so an
 * opaque picture decodes to the same bytes.
 *
 * @param pixels - The pixels.
 * @returns The data URL.
 * @throws {Error} When the browser answers another type: it encodes no WebP.
 */
async function pageEncode(pixels: Pixels): Promise<string> {
  const { canvas, context } = pageCanvas(pixels.width, pixels.height);

  context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);

  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 1 });

  if (blob.type !== "image/webp") {
    throw new Error(`The browser does not encode WebP: it answered ${blob.type}.`);
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";

  for (let start = 0; start < bytes.length; start += 32_768) {
    binary += String.fromCodePoint(...bytes.subarray(start, start + 32_768));
  }

  return `data:image/webp;base64,${btoa(binary)}`;
}

/**
 * Turns the PNG data URL of `renderer.capture()` into the lossless WebP of the baselines.
 *
 * @param url - The PNG data URL.
 * @returns The WebP data URL of the same pixels.
 */
async function pageWebp(url: string): Promise<string> {
  return pageEncode(await pageDecode(url));
}

/**
 * Compares the baseline picture with the capture inside the page, on an `OffscreenCanvas`, so
 * the Bun side needs no image library. The diff picture comes back only when a pixel differs.
 *
 * @param argument - The test and the step, the two WebP data URLs and the channel threshold.
 * @param argument.expected - The baseline `screen.webp`.
 * @param argument.actual - The capture.
 * @param argument.threshold - The largest channel delta that still counts as the same pixel.
 * @returns The counts and the diff picture, or why the pictures could not be compared.
 */
export async function pageCompare(
  argument: Place & { expected: string; actual: string; threshold: number }
): Promise<PageAnswer<PageCompared>> {
  try {
    const [expected, actual] = await Promise.all([
      pageDecode(argument.expected),
      pageDecode(argument.actual)
    ]);
    const found = comparePixels(expected, actual, argument.threshold);
    const counts = { sameSize: found.sameSize, differing: found.differing, total: found.total };

    if (found.differing === 0) return { ok: true, value: counts };

    const diff = await pageEncode({
      width: expected.width,
      height: expected.height,
      data: found.diff
    });

    return { ok: true, value: { ...counts, diff } };
  } catch (error) {
    return { ok: false, reason: pageMessage(error) };
  }
}

/** Every function of the page script, in the order the page gets them. */
const pageFunctions: ReadonlyArray<{ readonly name: string }> = [
  pageReady,
  isPageGame,
  isPageDoors,
  pageHandles,
  pageFrame,
  pageTask,
  pageMessage,
  pageStepFrame,
  pageTick,
  pageSettle,
  pageRun,
  pageStart,
  pagePause,
  pageStep,
  pageCheckpoint,
  channelDelta,
  comparePixels,
  pageCanvas,
  pageDecode,
  pageEncode,
  pageWebp,
  pageCompare
];

/**
 * Writes the script that installs the page functions in the dev page, each under its own name on
 * `globalThis`. The leg adds it as an init script, so it runs before the page's own code, on
 * every load.
 *
 * @returns The source of the script.
 */
export function pageScript(): string {
  const lines = pageFunctions.flatMap(fn => [
    String(fn),
    `globalThis[${JSON.stringify(fn.name)}] = ${fn.name};`
  ]);

  return `(() => {\n${lines.join("\n")}\n})();\n`;
}
