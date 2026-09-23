import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { run } from "../../../flow/doors/run";
import type { Json } from "../../../model/types";
import type { UiApi } from "../../../ui/types";
import { createInputApi } from "../../api";
import { Draggable, DropTarget, Tappable } from "../../components";
import { dragCommand, keyCommand, tapCommand } from "../../control";
import type { InputApi } from "../../types";
import { createMockInput, type MockInput } from "./mock-input";

// ---------------------------------------------------------------------------
// Unit test: the input commands of the /control door over the real input API
// of the mock plugin
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A board with a Play button published as the ui key "play", a generator view and two items
 * that merge, and an app that reaches them through the real input API.
 *
 * @returns The mock plugin and the app the commands run on.
 */
function board(): {
  mock: MockInput;
  app: ReturnType<typeof createApp> & { input: InputApi; ui: UiApi };
} {
  const mock = createMockInput();
  const play = mock.spawn([Tappable({ intent: "play" })]);

  mock.spawn([Tappable({ intent: "tap", payload: { generatorId: "g1" } })], {
    projection: "board.generators",
    key: "g1"
  });
  mock.spawn([Draggable({ payload: { from: "c2" } })], { projection: "board.items", key: "i5" });
  mock.spawn([DropTarget({ intent: "merge", payload: { to: "c3" } })], {
    projection: "board.items",
    key: "i7"
  });

  const ui: UiApi = {
    tree: vi.fn(),
    find: (key: string) => (key === "play" ? play : undefined),
    lint: () => []
  };

  return { mock, app: { ...createApp(), input: createInputApi(mock.ctx), ui } };
}

describe("the input commands", () => {
  it("go through the graph: every effect is route", () => {
    expect(tapCommand.id).toBe("game.tap");
    expect(dragCommand.id).toBe("game.drag");
    expect(keyCommand.id).toBe("game.key");
    expect([tapCommand.effect, dragCommand.effect, keyCommand.effect]).toEqual([
      "route",
      "route",
      "route"
    ]);
  });

  it("refuse outside a dev build and leave a moku:dev entry inside one", async () => {
    const { mock, app } = board();

    expect(() => tapCommand.run(app, { key: "play" })).toThrow("dev builds only");
    expect(() => dragCommand.run(app, { from: {}, to: {} })).toThrow("dev builds only");
    expect(() => keyCommand.run(app, { key: "Escape" })).toThrow("dev builds only");
    expect(mock.answers).toEqual([]);

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await run(app, keyCommand, { key: "Escape" });

    expect(app.log.trace().at(-1)).toMatchObject({
      event: "moku:dev",
      data: { command: "game.key", key: "Escape" }
    });
  });
});

describe("game.tap", () => {
  it("taps a ui element by its key", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { mock, app } = board();

    const ran = await run(app, tapCommand, { key: "play" });

    expect(ran.value).toBe(true);
    expect(mock.answers).toEqual([{ intent: "play", payload: {} }]);
    expect(ran.state.tainted).toBe(false);
  });

  it("taps a view by its projection key", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { mock, app } = board();

    const ran = await run(app, tapCommand, {
      target: { projection: "board.generators", key: "g1" }
    });

    expect(ran.value).toBe(true);
    expect(mock.answers).toEqual([{ intent: "tap", payload: { generatorId: "g1" } }]);
  });

  it("answers what input.tap answers for a view that is gone", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app } = board();

    const ran = await run(app, tapCommand, { target: { projection: "board.items", key: "gone" } });

    expect(ran.value).toBe(false);
  });

  it("refuses a key that is not on screen", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { mock, app } = board();

    await expect(run(app, tapCommand, { key: "shop" })).rejects.toThrow(
      /^\[game] No element with the key "shop" is on screen\.\n {2}.*\.$/
    );
    expect(mock.answers).toEqual([]);
  });

  it.each([
    ["neither", {}],
    ["both", { key: "play", target: { projection: "board.generators", key: "g1" } }]
  ])("refuses %s of key and target", async (_name, input) => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { mock, app } = board();

    await expect(run(app, tapCommand, input)).rejects.toThrow(
      /^\[game] game\.tap takes a key or a target\.\n {2}.*\.$/
    );
    expect(mock.answers).toEqual([]);
  });
});

describe("game.drag", () => {
  it("drags one view onto another by their projection keys", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { mock, app } = board();

    const ran = await run(app, dragCommand, {
      from: { projection: "board.items", key: "i5" },
      to: { projection: "board.items", key: "i7" }
    });

    expect(ran.value).toBe(true);
    expect(mock.answers).toEqual([{ intent: "merge", payload: { from: "c2", to: "c3" } }]);
  });

  it.each([
    ["a string", "i5"],
    ["null", JSON.parse("null") as Json],
    ["a list", ["board.items", "i5"]],
    ["missing its key", { projection: "board.items" }],
    ["with a number as key", { projection: "board.items", key: 5 }]
  ])("refuses a target that is %s", async (_name, from: Json) => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { mock, app } = board();

    await expect(
      run(app, dragCommand, { from, to: { projection: "board.items", key: "i7" } })
    ).rejects.toThrow(/^\[game] The target is not a projection key\.\n {2}.*\.$/);
    expect(mock.answers).toEqual([]);
  });
});

describe("game.key", () => {
  it("presses a key through the onKey listeners, with Shift when asked", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app } = board();
    const pressed: Array<{ key: string; shift: boolean }> = [];

    app.input.onKey(key => {
      pressed.push(key);

      return key.key === "Tab";
    });

    const tab = await run(app, keyCommand, { key: "Tab", shift: true });
    const other = await run(app, keyCommand, { key: "q" });

    expect(tab.value).toBe(true);
    expect(other.value).toBe(false);
    expect(pressed).toEqual([
      { key: "Tab", shift: true },
      { key: "q", shift: false }
    ]);
  });
});
