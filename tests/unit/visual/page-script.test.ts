import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "../../../src/plugins/flow/doors/commands";
import { read } from "../../../src/plugins/flow/doors/read";
import { run } from "../../../src/plugins/flow/doors/run";
import { sources } from "../../../src/plugins/flow/doors/sources";
import {
  comparePixels,
  pageCheckpoint,
  pageCompare,
  pagePause,
  pageReady,
  pageScript,
  pageStart,
  pageStep
} from "../../../src/visual/page-script";
import type { VisualApp } from "../../../src/visual/types";
import { enterPage, installCodec, pictureOf, pngOf, startPageGame, webpOf } from "./page";

// ---------------------------------------------------------------------------
// Unit (no browser): the page functions run here against the tiny game, with
// requestAnimationFrame running browser frames of 25 ms unless the game is
// paused, and a fake image codec; the pixel math runs on small RGBA buffers;
// the page script installs in a fresh context
// ---------------------------------------------------------------------------

/** The frame the leg steps: 60 fps, the frame of the headless leg's settle. */
const FRAME_MS = 1000 / 60;

const URL = "http://localhost:3000/";

let stops: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const stop of stops) await stop();
  stops = [];
  vi.unstubAllGlobals();
});

/**
 * Starts the page game and stops it after the test.
 *
 * @param options - What the renderer reports and captures.
 * @returns The page game.
 */
async function pageGame(options: Parameters<typeof startPageGame>[0] = {}) {
  const started = await startPageGame(options);
  const leave = enterPage();

  stops.push(async () => {
    leave();
    await started.stop();
  });

  return started;
}

/**
 * Puts a game that rests nowhere in the page: running, no gate, at a path.
 *
 * @param run - What `doors.run` does.
 */
function stuckGame(run: () => Promise<unknown> = () => Promise.resolve({})) {
  vi.stubGlobal("game", {
    flow: { state: () => ({ running: true, pending: {}, path: "board/deliver" }) },
    anim: { finishAll: () => {} },
    renderer: { capture: () => Promise.resolve(undefined) }
  });
  vi.stubGlobal("doors", { read: () => ({}), run, sources: {}, commands: {} });
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
    setTimeout(() => callback(0), 0);

    return 0;
  });
}

/**
 * Builds a row of pixels.
 *
 * @param pixels - The RGBA of each pixel.
 * @returns The picture, one pixel high.
 */
function row(...pixels: number[][]) {
  return { width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()) };
}

/**
 * Waits until the game has run a number of frames, whoever steps them.
 *
 * @param app - The page game.
 * @param count - How many frames.
 * @returns A promise that settles after the last of them.
 */
function afterFrames(app: VisualApp, count: number): Promise<void> {
  return new Promise(resolve => {
    let left = count;
    const off = app.time.onFrame("signals", () => {
      left -= 1;

      if (left > 0) return;

      off();
      resolve();
    });
  });
}

/**
 * Puts doors in the page whose `restore` first waits for frames, or forever.
 *
 * @param app - The page game.
 * @param frames - How many frames the restore waits; `undefined` waits forever.
 */
function slowRestore(app: VisualApp, frames: number | undefined): void {
  vi.stubGlobal("doors", {
    read,
    sources,
    commands,
    run: (target: VisualApp, command: { id: string }, input: object) => {
      if (command.id !== "game.restore")
        return Reflect.apply(run, undefined, [target, command, input]);
      if (frames === undefined) return new Promise(() => {});

      return afterFrames(app, frames).then(() =>
        Reflect.apply(run, undefined, [target, command, input])
      );
    }
  });
}

/** The restore of a start with 7 coins at Home, as the leg sends it. */
const restore = {
  test: "open-popup",
  where: "the start",
  name: "restore" as const,
  input: { repro: { player: { coins: 7 }, checkpoint: "home", route: [] } },
  settleFrames: 600
};

describe("comparePixels", () => {
  it("finds nothing in two equal pictures, and draws the baseline faded", () => {
    const picture = row([0, 0, 0, 255], [255, 255, 255, 255]);
    const found = comparePixels(picture, row([0, 0, 0, 255], [255, 255, 255, 255]), 24);

    expect(found).toMatchObject({ sameSize: true, differing: 0, total: 2 });
    expect([...found.diff]).toEqual([191, 191, 191, 255, 255, 255, 255, 255]);
  });

  it("lets a channel off by the threshold pass, and counts one off by more, in red", () => {
    const baseline = row([100, 100, 100, 255], [100, 100, 100, 255]);
    const under = comparePixels(baseline, row([124, 100, 100, 255], [100, 76, 100, 255]), 24);
    const over = comparePixels(baseline, row([125, 100, 100, 255], [100, 100, 100, 255]), 24);

    expect(under.differing).toBe(0);
    expect(over.differing).toBe(1);
    expect([...over.diff].slice(0, 4)).toEqual([255, 0, 0, 255]);
    expect([...over.diff].slice(4)).toEqual([216, 216, 216, 255]);
  });

  it("counts the alpha channel as a channel", () => {
    expect(comparePixels(row([0, 0, 0, 255]), row([0, 0, 0, 200]), 24).differing).toBe(1);
  });

  it("refuses pictures of two sizes", () => {
    const found = comparePixels(row([0, 0, 0, 255]), row([0, 0, 0, 255], [0, 0, 0, 255]), 24);

    expect(found).toMatchObject({ sameSize: false, differing: 0, total: 0 });
  });
});

describe("pageReady", () => {
  it("waits for both handles of the page contract", () => {
    expect(pageReady()).toBe(false);

    vi.stubGlobal("game", {});
    expect(pageReady()).toBe(false);

    vi.stubGlobal("doors", {});
    expect(pageReady()).toBe(true);
  });
});

describe("pageStart", () => {
  it("waits for the page's graph to rest at a gate, and answers the renderer's kind", async () => {
    await pageGame({ kind: "webgl" });

    expect(await pageStart({ url: URL, settleFrames: 600 })).toEqual({ ok: true, value: "webgl" });
  });

  it("gives up when the graph never rests at a gate", async () => {
    const { app } = await pageGame({ runGraph: false });
    const answer = await pageStart({ url: URL, settleFrames: 3 });

    expect(answer).toEqual({
      ok: false,
      error: `[game] The page at ${URL} did not rest at a gate in 3 frames.\n  The graph stands at "${app.flow.state().path}"; start the app and run its graph in the dev page.`
    });
  });

  it("answers why when the page has no game and doors", async () => {
    expect(await pageStart({ url: URL, settleFrames: 3 })).toEqual({
      ok: false,
      reason:
        "[game] The page exposes no game and doors.\n  Set globalThis.game and globalThis.doors in the dev page."
    });
  });
});

describe("pageStep", () => {
  it("runs a command through the doors and settles at the next gate", async () => {
    const { app } = await pageGame();

    expect(await pageStart({ url: URL, settleFrames: 600 })).toMatchObject({ ok: true });
    expect(await pageStep(restore)).toEqual({ ok: true, value: undefined });
    expect(read(app, sources.model).player).toEqual({ coins: 7 });

    const tap = { ...restore, where: "step 1 (tap)", name: "tap", input: { key: "open" } } as const;

    expect(await pageStep(tap)).toEqual({ ok: true, value: undefined });
    expect(app.flow.state().pending.gate).toBeDefined();
    expect(app.flow.state().path).not.toBe("home");
  });

  it("taps a popup's button right after the tap that opened it", async () => {
    const { app } = await pageGame();
    const tap = { ...restore, where: "step 1 (tap)", name: "tap", input: { key: "open" } } as const;

    await pageStart({ url: URL, settleFrames: 600 });
    await pageStep(restore);
    await pageStep(tap);

    expect(await pageStep({ ...tap, where: "step 2 (tap)", input: { key: "claim" } })).toEqual({
      ok: true,
      value: undefined
    });
    expect(read(app, sources.model).player).toEqual({ coins: 12 });
  });

  it("answers the reason when the command throws", async () => {
    await pageGame();
    await pageStart({ url: URL, settleFrames: 600 });

    const answer = await pageStep({ ...restore, name: "tap", input: { key: "missing" } });

    expect(answer).toMatchObject({ ok: false });
    expect(answer.ok ? "" : Reflect.get(answer, "reason")).toContain(
      'No element with the key "missing" is on screen.'
    );
  });

  it("answers the settle error that names the test, the step and the path", async () => {
    stuckGame();

    const answer = await pageStep({
      test: "reward-popup",
      where: "step 2 (answer)",
      name: "answer",
      input: { intent: "deliver" },
      settleFrames: 3
    });

    expect(answer).toEqual({
      ok: false,
      error:
        '[game] Visual test "reward-popup", step 2 (answer) did not settle in 3 frames.\n  The graph stands at "board/deliver"; add a step that answers what it waits for.'
    });
  });
});

describe("pagePause", () => {
  const place = { test: "open-popup", where: "the start" };

  it("pauses the game for the devtools and steps it to the start time, never more than a frame of 1000/60 at once", async () => {
    const { app } = await pageGame();

    await pageStart({ url: URL, settleFrames: 600 });

    const deltas: number[] = [];
    const from = app.time.snapshot().elapsed;

    app.time.onFrame("input", time => deltas.push(time.delta));

    expect(await pagePause({ ...place, startMs: 1000 })).toEqual({ ok: true, value: 1000 });
    expect(app.lifecycle.reasons()).toEqual(["devtools"]);
    expect(app.time.isPaused()).toBe(true);
    expect(app.time.snapshot().elapsed).toBe(1000);
    expect(deltas).toHaveLength(Math.ceil((1000 - from) / FRAME_MS));
    expect(Math.max(...deltas)).toBeLessThanOrEqual(FRAME_MS);
  });

  it("lands on the same game time whatever time the page's own frames left behind", async () => {
    const { app } = await pageGame();

    app.time.step(83.236_666);

    expect(await pagePause({ ...place, startMs: 1000 })).toEqual({ ok: true, value: 1000 });
    expect(app.time.snapshot().elapsed).toBe(1000);
  });

  it("steps to the next multiple of the start time when the page took longer", async () => {
    const { app } = await pageGame();

    app.time.step(1500);

    expect(await pagePause({ ...place, startMs: 1000 })).toEqual({ ok: true, value: 2000 });
  });

  it("answers the reason when the page refuses the pause", async () => {
    await pageGame();
    vi.stubGlobal("__MOKU_GAME_DEV__", false);

    expect(await pagePause({ ...place, startMs: 1000 })).toEqual({
      ok: false,
      reason:
        "[game] Control commands run in dev builds only.\n  Define __MOKU_GAME_DEV__ as true in the dev build."
    });
  });
});

describe("pageStep while the leg holds the pause", () => {
  it("moves game time only by stepped frames of 1000/60, never by the browser's frames", async () => {
    const { app } = await pageGame();
    const deltas: number[] = [];

    await pageStart({ url: URL, settleFrames: 600 });
    await pagePause({ test: "open-popup", where: "the start", startMs: 1000 });
    app.time.onFrame("input", time => deltas.push(time.delta));

    expect(await pageStep(restore)).toEqual({ ok: true, value: undefined });
    expect(
      await pageStep({ ...restore, where: "step 1 (tap)", name: "tap", input: { key: "open" } })
    ).toEqual({ ok: true, value: undefined });
    expect(deltas.length).toBeGreaterThan(0);
    expect(new Set(deltas)).toEqual(new Set([FRAME_MS]));
    expect(app.time.isPaused()).toBe(true);
  });

  it("steps frames while a command waits for them", async () => {
    const { app } = await pageGame();

    await pageStart({ url: URL, settleFrames: 600 });
    await pagePause({ test: "open-popup", where: "the start", startMs: 1000 });
    slowRestore(app, 3);

    expect(await pageStep(restore)).toEqual({ ok: true, value: undefined });
    expect(read(app, sources.model).player).toEqual({ coins: 7 });
  });

  it("answers the error that names the step when a command does not finish in settleFrames frames", async () => {
    const { app } = await pageGame();

    await pageStart({ url: URL, settleFrames: 600 });
    await pagePause({ test: "open-popup", where: "the start", startMs: 1000 });
    slowRestore(app, undefined);

    expect(await pageStep({ ...restore, settleFrames: 3 })).toEqual({
      ok: false,
      error:
        '[game] Visual test "open-popup", the start did not finish in 3 frames.\n  The graph stands at "home"; the command waits for something the stepped frames never bring.'
    });
  });
});

describe("pageCheckpoint", () => {
  it("lands every motion, then captures the screen as lossless WebP and reads the state through the doors", async () => {
    installCodec();

    const screen = pngOf(2, 1, index => (index === 0 ? [200, 20, 30, 255] : [10, 20, 30, 255]));
    const { app, game } = await pageGame({ screen: () => screen });
    const seen: { landed?: number } = {};

    vi.stubGlobal("game", {
      ...game,
      anim: {
        ...game.anim,
        finishAll: () => {
          seen.landed = app.anim.active();
          app.anim.finishAll();
        }
      }
    });

    await pageStart({ url: URL, settleFrames: 600 });
    await pageStep(restore);
    await pageStep({ ...restore, name: "tap", input: { key: "open" } });

    const answer = await pageCheckpoint({ test: "open-popup", where: "step 2", settleFrames: 600 });

    expect(seen.landed).toBeGreaterThan(0);
    expect(app.anim.active()).toBe(0);
    expect(answer).toMatchObject({
      ok: true,
      value: { state: { path: app.flow.state().path, player: { coins: 7 } } }
    });

    const shot = answer.ok ? (answer.value.screen ?? "") : "";

    expect(shot.startsWith("data:image/webp;base64,")).toBe(true);
    expect(pictureOf(shot)).toEqual(pictureOf(screen));
    expect(Object.keys(answer.ok ? answer.value.state : {}).toSorted()).toEqual([
      "path",
      "player",
      "rng",
      "session"
    ]);
  });

  it("answers the reason when the capture throws", async () => {
    await pageGame({
      screen: () => {
        throw new Error("Pixi could not read the frame.");
      }
    });
    await pageStart({ url: URL, settleFrames: 600 });

    expect(await pageCheckpoint({ test: "t", where: "step 1", settleFrames: 600 })).toEqual({
      ok: false,
      reason: "Pixi could not read the frame."
    });
  });

  it("answers the settle error when the graph does not rest", async () => {
    stuckGame();

    const answer = await pageCheckpoint({
      test: "t",
      where: "step 1 (checkpoint)",
      settleFrames: 2
    });

    expect(answer).toMatchObject({ ok: false });
    expect(answer.ok ? "" : Reflect.get(answer, "error")).toContain("did not settle in 2 frames");
  });
});

describe("pageCompare", () => {
  const place = { test: "t", where: "step 1 (checkpoint)", threshold: 24 };

  it("answers same-size pictures with no diff picture when nothing differs", async () => {
    installCodec();

    const answer = await pageCompare({ ...place, expected: webpOf(2, 2), actual: webpOf(2, 2) });

    expect(answer).toEqual({ ok: true, value: { sameSize: true, differing: 0, total: 4 } });
  });

  it("answers the count and a lossless WebP diff picture, red where the pixels differ", async () => {
    installCodec();

    const changed = webpOf(2, 1, index => (index === 1 ? [200, 20, 30, 255] : [10, 20, 30, 255]));
    const answer = await pageCompare({ ...place, expected: webpOf(2, 1), actual: changed });

    expect(answer).toMatchObject({ ok: true, value: { sameSize: true, differing: 1, total: 2 } });

    const diff = answer.ok ? answer.value.diff : undefined;

    expect(diff?.startsWith("data:image/webp;base64,")).toBe(true);
    expect(pictureOf(diff ?? "").data).toEqual([194, 196, 199, 255, 255, 0, 0, 255]);
  });

  it("answers the reason when the browser encodes no WebP", async () => {
    installCodec({ encodes: "image/png" });

    const changed = webpOf(1, 1, () => [200, 20, 30, 255]);
    const answer = await pageCompare({ ...place, expected: webpOf(1, 1), actual: changed });

    expect(answer).toEqual({
      ok: false,
      reason: "The browser does not encode WebP: it answered image/png."
    });
  });

  it("answers sameSize false for pictures of two sizes", async () => {
    installCodec();

    const answer = await pageCompare({ ...place, expected: webpOf(2, 2), actual: webpOf(2, 1) });

    expect(answer).toEqual({ ok: true, value: { sameSize: false, differing: 0, total: 0 } });
  });

  it("answers the reason when the browser gives no 2D context", async () => {
    installCodec();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          // eslint-disable-next-line unicorn/no-null -- the DOM answers null when there is no 2D context
          return null;
        }
      }
    );

    const answer = await pageCompare({ ...place, expected: webpOf(1, 1), actual: webpOf(1, 1) });

    expect(answer).toEqual({
      ok: false,
      reason: "The browser gave no 2D context for an OffscreenCanvas."
    });
  });

  it("answers the reason when a picture does not decode", async () => {
    installCodec();
    vi.stubGlobal("createImageBitmap", () =>
      Promise.reject(new Error("The source image could not be decoded."))
    );

    const answer = await pageCompare({ ...place, expected: webpOf(1, 1), actual: webpOf(1, 1) });

    expect(answer).toEqual({ ok: false, reason: "The source image could not be decoded." });
  });
});

describe("pageScript", () => {
  it("installs every page function in a fresh context, where one sent alone still runs", async ctx => {
    ctx.skip(
      /\bcov_\w+\(/u.test(String(pageStep)),
      "coverage instruments the page functions, so they cannot leave this process"
    );

    const context = vm.createContext({
      setTimeout,
      requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(0)),
      game: {
        flow: { state: () => ({ running: true, pending: { gate: "home" }, path: "home" }) },
        anim: {},
        renderer: {}
      },
      doors: { read: () => ({}), run: () => Promise.resolve({}), sources: {}, commands: {} }
    });

    vm.runInContext(pageScript(), context);

    for (const name of [
      "pageReady",
      "pageStart",
      "pagePause",
      "pageStep",
      "pageCheckpoint",
      "pageCompare"
    ]) {
      expect(typeof context[name]).toBe("function");
    }

    // Playwright sends the one function a call names, by its source: it finds the others there.
    const step = vm.runInContext(`(${String(pageStep)})`, context);

    expect(await step({ ...restore, settleFrames: 3 })).toEqual({ ok: true, value: undefined });
    expect(vm.runInContext("pageReady()", context)).toBe(true);
  });
});
