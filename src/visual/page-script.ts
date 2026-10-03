/**
 * @file visual — the page script of the browser leg: plain functions that run inside the dev page.
 * They read only `globalThis.game`, `globalThis.doors` and what the browser offers, and they call
 * only each other: Playwright serialises the one function a call names and runs it in the page,
 * and `pageScript()` installs all of them there first, so the others are found by name. Nothing
 * in them may reach the scope of this module. Every function the leg calls answers instead of
 * throwing, so a failure comes back as a message and not as Playwright's own error.
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

/** What `pageCompare` answers: the counts, and the diff picture as a PNG data URL when one differs. */
export type PageCompared = { sameSize: boolean; differing: number; total: number; diff?: string };

/** What the page saw at a checkpoint: the state through the doors and the picture of the canvas. */
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
 * Waits for the next frame of the page.
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
 * Waits frame by frame until the graph rests at a gate or stops: at least one frame, at most
 * `limit`, then one frame more so the ui of a screen the gate opened is built. The settle of the
 * headless leg, on `requestAnimationFrame` instead of `time.step`.
 *
 * @param game - The game of the page.
 * @param limit - The most frames to wait, `settleFrames` of the run.
 * @param place - The test and the step, for the message.
 * @returns The error message when the graph did not rest, `undefined` when it did.
 */
async function pageSettle(
  game: VisualApp,
  limit: number,
  place: Place
): Promise<string | undefined> {
  for (let frame = 0; frame < limit; frame += 1) {
    await pageFrame();

    const state = game.flow.state();

    if (state.pending.gate !== undefined || !state.running) {
      await pageFrame();

      return undefined;
    }
  }

  return `[game] Visual test "${place.test}", ${place.where} did not settle in ${limit} frames.\n  The graph stands at "${game.flow.state().path}"; add a step that answers what it waits for.`;
}

/**
 * Waits until the page's own graph runs and rests at a gate, the way the dev page starts it, and
 * reads the backend the renderer chose.
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
 * Runs one `/control` command through the doors of the page, the way an editor does, then
 * settles. The leg restores the start of a test with it too, as the command `restore`.
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
    const { game, doors } = pageHandles();
    const runners: Readonly<Record<StepCommand, StepRunner>> = doors.commands;

    await doors.run(game, runners[argument.name], argument.input);

    const unsettled = await pageSettle(game, argument.settleFrames, argument);

    return unsettled === undefined
      ? { ok: true, value: undefined }
      : { ok: false, error: unsettled };
  } catch (error) {
    return { ok: false, reason: pageMessage(error) };
  }
}

/**
 * Plays a checkpoint in the page: settle, land every track and loop, two frames, then the picture
 * of the whole canvas and the state through the doors. The frame loop keeps running: the
 * picture is taken at the end of the next drawn frame.
 *
 * @param argument - The test and the step, and the most frames to settle.
 * @param argument.settleFrames - The most frames to settle.
 * @returns The state and the picture, or why the checkpoint failed.
 */
export async function pageCheckpoint(
  argument: Place & { settleFrames: number }
): Promise<PageAnswer<PageShot>> {
  try {
    const { game, doors } = pageHandles();
    const unsettled = await pageSettle(game, argument.settleFrames, argument);

    if (unsettled !== undefined) return { ok: false, error: unsettled };

    game.anim.finishAll();
    await pageFrame();
    await pageFrame();

    const screen = await game.renderer.capture();
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
 * Decodes a PNG data URL into its pixels, with no colour conversion.
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
 * Encodes pixels as a PNG data URL.
 *
 * @param pixels - The pixels.
 * @returns The data URL.
 */
async function pageEncode(pixels: Pixels): Promise<string> {
  const { canvas, context } = pageCanvas(pixels.width, pixels.height);

  context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);

  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";

  for (let start = 0; start < bytes.length; start += 32_768) {
    binary += String.fromCodePoint(...bytes.subarray(start, start + 32_768));
  }

  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * Compares the baseline picture with the capture inside the page, on an `OffscreenCanvas`, so
 * the Bun side needs no image library. The diff picture comes back only when a pixel differs.
 *
 * @param argument - The test and the step, the two PNG data URLs and the channel threshold.
 * @param argument.expected - The baseline `screen.png`.
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
  pageMessage,
  pageSettle,
  pageStart,
  pageStep,
  pageCheckpoint,
  channelDelta,
  comparePixels,
  pageCanvas,
  pageDecode,
  pageEncode,
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
