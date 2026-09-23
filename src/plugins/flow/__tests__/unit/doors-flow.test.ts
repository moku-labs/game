import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../model/types";
import { answerCommand, bookmarkCommand, restoreCommand, walkCommand } from "../../control";
import { read } from "../../doors/read";
import { run } from "../../doors/run";
import {
  cheatsSource,
  graphSource,
  historySource,
  positionSource,
  taintedSource
} from "../../inspect";
import type { JournalEntry } from "../../types";
import { createDoorsFake } from "./doors-fake";

// ---------------------------------------------------------------------------
// Unit test: the flow sources and commands over a hand-written app
// ---------------------------------------------------------------------------

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

afterEach(() => {
  vi.unstubAllGlobals();
});

const entry = (index: number): JournalEntry => ({
  index,
  path: "home",
  outcome: "play",
  payload: noPayload,
  next: "board/awaitIntent",
  now: 1000 + index,
  hash: "fbeb1a2f"
});

const bookmark = {
  path: "board/awaitIntent",
  input: noPayload,
  player: { coins: 7 },
  session: { taps: 0 },
  rng: { seed: 42, streams: { chest: 3 } },
  graph: "0badf00d"
};

/**
 * Builds the bookmark with fields replaced and one left out.
 *
 * @param changes - Fields to replace.
 * @param without - Field to leave out.
 * @returns The broken bookmark, as JSON.
 */
const bookmarkWith = (changes: Record<string, Json>, without = ""): Json =>
  Object.fromEntries(
    Object.entries({ ...bookmark, ...changes }).filter(([key]) => key !== without)
  );

const sources = [graphSource, positionSource, historySource, taintedSource, cheatsSource];

/** Reads every flow source once, the way an editor panel list does. */
const readAll = (app: Parameters<typeof graphSource.read>[0]): unknown[] => [
  read(app, graphSource),
  read(app, positionSource),
  read(app, historySource),
  read(app, taintedSource),
  read(app, cheatsSource)
];
const commands = [answerCommand, walkCommand, bookmarkCommand, restoreCommand];

describe("flow sources", () => {
  it("have unique ids in the game namespace", () => {
    const ids = [...sources, ...commands].map(descriptor => descriptor.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => id.startsWith("game."))).toBe(true);
  });

  it("change with the graph, the tainted flag and the cheats with every frame", () => {
    expect(graphSource.changes).toBe("edge");
    expect(positionSource.changes).toBe("edge");
    expect(historySource.changes).toBe("edge");
    expect(taintedSource.changes).toBe("frame");
    expect(cheatsSource.changes).toBe("frame");
  });

  it("game.graph reads the described graph", () => {
    const fake = createDoorsFake();

    expect(read(fake.app, graphSource)).toBe(fake.app.flow.describe());
  });

  it("game.position reads the path, the node and what the gate waits for", () => {
    const fake = createDoorsFake();

    fake.moveGraph("board/awaitIntent");

    expect(read(fake.app, positionSource)).toEqual({
      path: "board/awaitIntent",
      flow: "board",
      node: "awaitIntent",
      waiting: ["play"]
    });
  });

  it("game.position waits for nothing while the gate is closed", () => {
    const fake = createDoorsFake();
    const moving = { ...fake.app.flow.state(), pending: {} };
    const app = { ...fake.app, flow: { ...fake.app.flow, state: () => moving } };

    expect(read(app, positionSource).waiting).toEqual([]);
  });

  it("game.position has no node before the graph has a position", () => {
    const fake = createDoorsFake();

    fake.moveGraph("");

    expect(read(fake.app, positionSource)).toMatchObject({ path: "", node: undefined });
  });

  it("game.history reads the whole journal, or its last entries", () => {
    const fake = createDoorsFake();

    fake.journal([entry(1), entry(2), entry(3)]);

    expect(read(fake.app, historySource).map(item => item.index)).toEqual([1, 2, 3]);
    expect(read(fake.app, historySource, { last: 2 }).map(item => item.index)).toEqual([2, 3]);
    expect(read(fake.app, historySource, { last: 0 })).toEqual([]);
  });

  it("game.tainted and game.cheats start clean", () => {
    const fake = createDoorsFake();

    expect(read(fake.app, taintedSource)).toBe(false);
    expect(read(fake.app, cheatsSource)).toEqual([]);
  });

  it("never change the graph, the snapshot or the journal", () => {
    const fake = createDoorsFake();
    const state = fake.app.flow.state();
    const snapshot = fake.app.model.store.snapshot();

    expect(readAll(fake.app)).toHaveLength(sources.length);

    expect(fake.app.flow.state()).toBe(state);
    expect(fake.app.model.store.snapshot()).toBe(snapshot);
    expect(fake.answers).toEqual([]);
  });
});

describe("flow commands", () => {
  it("carry the effects of page 7: answer and walk route, bookmark reads, restore is raw", () => {
    expect(answerCommand.effect).toBe("route");
    expect(walkCommand.effect).toBe("route");
    expect(bookmarkCommand.effect).toBe("read");
    expect(restoreCommand.effect).toBe("raw");
  });

  it("refuse outside a dev build even when called directly", () => {
    const fake = createDoorsFake();

    expect(() => answerCommand.run(fake.app, { intent: "play" })).toThrow(
      "Control commands run in dev builds only"
    );
    expect(() => walkCommand.run(fake.app, { route: [] })).toThrow("dev builds only");
    expect(() => bookmarkCommand.run(fake.app, {})).toThrow("dev builds only");
    expect(() => restoreCommand.run(fake.app, { bookmark })).toThrow("dev builds only");
    expect(fake.answers).toEqual([]);
  });

  it("leave a moku:dev entry in the log", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();

    await run(fake.app, answerCommand, { intent: "play" });

    expect(fake.app.log.trace().at(-1)).toMatchObject({
      level: "debug",
      event: "moku:dev",
      data: { command: "game.answer" }
    });
  });

  it("game.answer answers the gate, with and without a payload", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();

    const taken = await run(fake.app, answerCommand, { intent: "play" });
    const refused = await run(fake.app, answerCommand, { intent: "tap", payload: { cell: "a1" } });

    expect(taken.value).toBe(true);
    expect(refused.value).toBe(false);
    expect(fake.answers).toEqual([{ intent: "play" }, { intent: "tap", payload: { cell: "a1" } }]);
    expect(refused.state.tainted).toBe(false);
  });

  it("game.walk walks a JSON route and keeps the session clean", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();
    const route = [
      { at: "home", intent: "play" },
      { at: "board/awaitIntent", intent: "tap", payload: { generatorId: "sawmill" } },
      { at: "board", result: { outcome: "left" } },
      { at: "board", result: { outcome: "won", payload: { stars: 3 } } }
    ];

    const ran = await run(fake.app, walkCommand, { route });

    expect(fake.routes).toEqual([route]);
    expect(ran.value.path).toBe("board/awaitIntent");
    expect(ran.state).toMatchObject({ path: "board/awaitIntent", tainted: false });
  });

  it.each([
    ["not a list", { at: "home", intent: "play" }],
    ["a step without at", [{ intent: "play" }]],
    ["a step with neither intent nor result", [{ at: "home" }]],
    ["a result without outcome", [{ at: "board", result: { payload: 1 } }]],
    ["a null step", [noPayload]]
  ])("game.walk refuses a route that is %s", async (_name, route: Json) => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();

    await expect(run(fake.app, walkCommand, { route })).rejects.toThrow(
      /^\[game] The route is not a list of route steps\.\n {2}.*\.$/
    );
    expect(fake.routes).toEqual([]);
  });

  it("game.bookmark hands back the bookmark of the rest point", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();

    const ran = await run(fake.app, bookmarkCommand);

    expect(ran.value).toBe(fake.app.flow.bookmark());
    expect(ran.state.tainted).toBe(false);
  });

  it("game.restore enters a bookmark and taints the session", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();

    const ran = await run(fake.app, restoreCommand, { bookmark });

    expect(fake.restored).toEqual([bookmark]);
    expect(ran.value.path).toBe("board/awaitIntent");
    expect(ran.state).toMatchObject({ path: "board/awaitIntent", tainted: true });
    expect(read(fake.app, taintedSource)).toBe(true);
    expect(read(fake.app, cheatsSource)).toEqual([
      { id: "game.restore", input: { bookmark }, frame: 0 }
    ]);
  });

  it("game.restore turns a repro into a bookmark, then walks its route", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();
    const repro = {
      player: { coins: 3 },
      session: { taps: 1 },
      rng: { seed: 9, streams: { dice: 2 } },
      checkpoint: "home",
      route: [{ at: "home", intent: "play" }]
    };

    const ran = await run(fake.app, restoreCommand, { repro });

    expect(fake.restored).toEqual([
      {
        path: "home",
        input: noPayload,
        player: { coins: 3 },
        session: { taps: 1 },
        rng: { seed: 9, streams: { dice: 2 } },
        graph: expect.any(String)
      }
    ]);
    expect(fake.routes).toEqual([[{ at: "home", intent: "play" }]]);
    expect(ran.state).toMatchObject({ path: "board/awaitIntent", tainted: true });
  });

  it("game.restore starts a repro without checkpoint at the main flow's start", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();

    await run(fake.app, restoreCommand, { repro: { player: { coins: 0 }, route: [] } });

    expect(fake.restored[0]).toMatchObject({
      path: "home",
      session: {},
      rng: { seed: 1, streams: {} }
    });
  });

  it.each([
    ["neither", {}],
    ["both", { bookmark, repro: { player: {}, route: [] } }]
  ])("game.restore refuses %s of bookmark and repro", async (_name, input) => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();

    await expect(run(fake.app, restoreCommand, input)).rejects.toThrow(
      /^\[game] game\.restore takes a bookmark or a repro\.\n {2}.*\.$/
    );
    expect(fake.restored).toEqual([]);
  });

  it.each([
    ["not a record", "home"],
    ["missing its path", bookmarkWith({ path: 1 })],
    ["missing its graph", bookmarkWith({}, "graph")],
    ["missing its player", bookmarkWith({}, "player")],
    ["with a broken rng", bookmarkWith({ rng: { seed: "1", streams: {} } })],
    ["with a broken stream", bookmarkWith({ rng: { seed: 1, streams: { dice: "2" } } })]
  ])("game.restore refuses a bookmark %s", async (_name, value: Json) => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();

    await expect(run(fake.app, restoreCommand, { bookmark: value })).rejects.toThrow(
      /^\[game] The bookmark is not a flow\.bookmark\(\) value\.\n {2}.*\.$/
    );
  });

  it.each([
    ["not a record", [1]],
    ["missing its player", { route: [] }],
    ["with a number as checkpoint", { player: {}, checkpoint: 3, route: [] }],
    ["with a broken rng", { player: {}, rng: { seed: 1 }, route: [] }]
  ])("game.restore refuses a repro %s", async (_name, repro: Json) => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();

    await expect(run(fake.app, restoreCommand, { repro })).rejects.toThrow(
      /^\[game] The repro is not a Repro\.\n {2}.*\.$/
    );
  });

  it("game.restore refuses a repro with a broken route", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();
    const repro = { player: {}, route: [{ at: 1 }] };

    await expect(run(fake.app, restoreCommand, { repro })).rejects.toThrow(
      "The route is not a list of route steps"
    );
  });
});
