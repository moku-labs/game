import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { read } from "../../../src/plugins/flow/doors/read";
import { sources } from "../../../src/plugins/flow/doors/sources";
import {
  comparePixels,
  pageCheckpoint,
  pageCompare,
  pageReady,
  pageScript,
  pageStart,
  pageStep
} from "../../../src/visual/page-script";
import { enterPage, installCodec, pictureOf, pngOf, startPageGame } from "./page";

// ---------------------------------------------------------------------------
// Unit (no browser): the page functions run here against the tiny game, with
// requestAnimationFrame stepping its clock and a fake image codec; the pixel
// math runs on small RGBA buffers; the page script installs in a fresh context
// ---------------------------------------------------------------------------

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

describe("pageCheckpoint", () => {
  it("lands every motion, then captures the screen and reads the state through the doors", async () => {
    const screen = pngOf(2, 1);
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
      value: { screen, state: { path: app.flow.state().path, player: { coins: 7 } } }
    });
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

    const answer = await pageCompare({ ...place, expected: pngOf(2, 2), actual: pngOf(2, 2) });

    expect(answer).toEqual({ ok: true, value: { sameSize: true, differing: 0, total: 4 } });
  });

  it("answers the count and a diff picture, red where the pixels differ", async () => {
    installCodec();

    const changed = pngOf(2, 1, index => (index === 1 ? [200, 20, 30, 255] : [10, 20, 30, 255]));
    const answer = await pageCompare({ ...place, expected: pngOf(2, 1), actual: changed });

    expect(answer).toMatchObject({ ok: true, value: { sameSize: true, differing: 1, total: 2 } });

    const diff = answer.ok ? answer.value.diff : undefined;

    expect(diff?.startsWith("data:image/png;base64,")).toBe(true);
    expect(pictureOf(diff ?? "").data).toEqual([194, 196, 199, 255, 255, 0, 0, 255]);
  });

  it("answers sameSize false for pictures of two sizes", async () => {
    installCodec();

    const answer = await pageCompare({ ...place, expected: pngOf(2, 2), actual: pngOf(2, 1) });

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

    const answer = await pageCompare({ ...place, expected: pngOf(1, 1), actual: pngOf(1, 1) });

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

    const answer = await pageCompare({ ...place, expected: pngOf(1, 1), actual: pngOf(1, 1) });

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

    for (const name of ["pageReady", "pageStart", "pageStep", "pageCheckpoint", "pageCompare"]) {
      expect(typeof context[name]).toBe("function");
    }

    // Playwright sends the one function a call names, by its source: it finds the others there.
    const step = vm.runInContext(`(${String(pageStep)})`, context);

    expect(await step({ ...restore, settleFrames: 3 })).toEqual({ ok: true, value: undefined });
    expect(vm.runInContext("pageReady()", context)).toBe(true);
  });
});
