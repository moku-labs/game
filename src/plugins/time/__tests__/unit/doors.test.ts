import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { run } from "../../../flow/doors/run";
import { stepCommand } from "../../control";

// ---------------------------------------------------------------------------
// Unit test: the time command of the /control door over the real time plugin
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("game.step", () => {
  it("is a cosmetic command with a frame count and an optional frame length", () => {
    expect(stepCommand.id).toBe("game.step");
    expect(stepCommand.effect).toBe("cosmetic");
    expect(stepCommand.input).toEqual({ frames: "number", deltaMs: "number?" });
  });

  it("steps frames of 1000/60 ms by default and answers the time after them", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createApp();

    const ran = await run(app, stepCommand, { frames: 3 });

    expect(ran.value).toMatchObject({ frame: 3, delta: 1000 / 60 });
    expect(ran.value.elapsed).toBeCloseTo(50, 5);
    expect(ran.state).toMatchObject({ frame: 3, tainted: false });
  });

  it("steps frames of the given length, also while the game is paused", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createApp();

    app.lifecycle.push("devtools");

    const ran = await run(app, stepCommand, { frames: 2, deltaMs: 10 });

    expect(ran.value).toMatchObject({ frame: 2, delta: 10, elapsed: 20 });
    expect(app.time.isPaused()).toBe(true);
  });

  it("steps nothing for zero frames", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createApp();

    const ran = await run(app, stepCommand, { frames: 0 });

    expect(ran.value.frame).toBe(0);
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["not finite", Number.POSITIVE_INFINITY]
  ])("refuses a frame count that is %s", async (_name, frames) => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createApp();

    await expect(run(app, stepCommand, { frames })).rejects.toThrow(
      /^\[game] game\.step takes a whole number of frames\.\n {2}.*\.$/
    );
    expect(app.time.snapshot().frame).toBe(0);
  });

  it("refuses outside a dev build and leaves a moku:dev entry inside one", async () => {
    const app = createApp();

    expect(() => stepCommand.run(app, { frames: 1 })).toThrow("dev builds only");
    expect(app.time.snapshot().frame).toBe(0);

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await run(app, stepCommand, { frames: 1 });

    expect(app.log.trace().at(-1)).toMatchObject({
      level: "debug",
      event: "moku:dev",
      data: { command: "game.step" }
    });
  });
});
