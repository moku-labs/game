import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { run } from "../../../flow/doors/run";
import type { Json } from "../../../model/types";
import { createInputApi } from "../../api";
import { Draggable, DropTarget } from "../../components";
import { dragCommand, keyCommand } from "../../control";
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
 * A board with two items that merge, and an app that reaches them through the real input API.
 *
 * @returns The mock plugin and the app the commands run on.
 */
function board(): { mock: MockInput; app: ReturnType<typeof createApp> & { input: InputApi } } {
  const mock = createMockInput();

  mock.spawn([Draggable({ payload: { from: "c2" } })], { projection: "board.items", key: "i5" });
  mock.spawn([DropTarget({ intent: "merge", payload: { to: "c3" } })], {
    projection: "board.items",
    key: "i7"
  });

  return { mock, app: { ...createApp(), input: createInputApi(mock.ctx) } };
}

describe("the input commands", () => {
  it("go through the graph: every effect is route", () => {
    expect(dragCommand.id).toBe("game.drag");
    expect(keyCommand.id).toBe("game.key");
    expect([dragCommand.effect, keyCommand.effect]).toEqual(["route", "route"]);
  });

  it("refuse outside a dev build and leave a moku:dev entry inside one", async () => {
    const { mock, app } = board();

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
