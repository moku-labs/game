import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { run } from "../../../flow/doors/run";
import type { Target } from "../../../input/types";
import { tapCommand } from "../../control";

// ---------------------------------------------------------------------------
// Unit test: the ui command of the /control door over a stub input and a
// screen with one keyed element
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The entity of the Play button, the one keyed element on screen. */
const PLAY = 7;

/**
 * Finds the one keyed element of the screen.
 *
 * @param key - The key asked for.
 * @returns The entity of Play for "play", `undefined` for any other key.
 */
function find(key: string): number | undefined {
  return key === "play" ? PLAY : undefined;
}

/**
 * An app whose screen holds the Play button under the key "play", with a tap that records its
 * target and answers true unless the view is gone.
 *
 * @returns The app the command runs on and the targets tapped.
 */
function screen(): {
  app: ReturnType<typeof createApp> & {
    input: { tap(target: Target): boolean };
    ui: { find(key: string): number | undefined };
  };
  tapped: Target[];
} {
  const tapped: Target[] = [];
  const tap = (target: Target): boolean => {
    tapped.push(target);

    return typeof target === "number" || target.key !== "gone";
  };
  return { app: { ...createApp(), input: { tap }, ui: { find } }, tapped };
}

describe("game.tap", () => {
  it("goes through the graph: its effect is route", () => {
    expect(tapCommand.id).toBe("game.tap");
    expect(tapCommand.effect).toBe("route");
  });

  it("refuses outside a dev build and leaves a moku:dev entry inside one", async () => {
    const { app, tapped } = screen();

    expect(() => tapCommand.run(app, { key: "play" })).toThrow("dev builds only");
    expect(tapped).toEqual([]);

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await run(app, tapCommand, { key: "play" });

    expect(app.log.trace().at(-1)).toMatchObject({
      event: "moku:dev",
      data: { command: "game.tap", key: "play" }
    });
  });

  it("taps a ui element by its key, through ui.find", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, tapped } = screen();

    const ran = await run(app, tapCommand, { key: "play" });

    expect(ran.value).toBe(true);
    expect(tapped).toEqual([PLAY]);
    expect(ran.state.tainted).toBe(false);
  });

  it("taps a view by its projection key", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, tapped } = screen();

    const ran = await run(app, tapCommand, {
      target: { projection: "board.generators", key: "g1" }
    });

    expect(ran.value).toBe(true);
    expect(tapped).toEqual([{ projection: "board.generators", key: "g1" }]);
  });

  it("answers what input.tap answers for a view that is gone", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app } = screen();

    const ran = await run(app, tapCommand, { target: { projection: "board.items", key: "gone" } });

    expect(ran.value).toBe(false);
  });

  it("refuses a key that is not on screen", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, tapped } = screen();

    await expect(run(app, tapCommand, { key: "shop" })).rejects.toThrow(
      /^\[game] No element with the key "shop" is on screen\.\n {2}.*\.$/
    );
    expect(tapped).toEqual([]);
  });

  it("refuses a target that is not a projection key", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, tapped } = screen();

    await expect(run(app, tapCommand, { target: "g1" })).rejects.toThrow(
      /^\[game] The target is not a projection key\.\n {2}.*\.$/
    );
    expect(tapped).toEqual([]);
  });

  it.each([
    ["neither", {}],
    ["both", { key: "play", target: { projection: "board.generators", key: "g1" } }]
  ])("refuses %s of key and target", async (_name, input) => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, tapped } = screen();

    await expect(run(app, tapCommand, input)).rejects.toThrow(
      /^\[game] game\.tap takes a key or a target\.\n {2}.*\.$/
    );
    expect(tapped).toEqual([]);
  });
});
