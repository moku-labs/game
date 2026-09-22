import { describe, expect, it } from "vitest";
import { createApp, createPlugin, defineGame, projection, screen, type } from "../../../../index";
import { defineScene } from "../../define";
import { scenesPlugin } from "../../index";
import type { Events } from "../../types";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock, flow, world, renderer,
// input, assets and scenes plugins, in plain Bun. There is no document, so
// `renderer` is inert and `assets` is headless: every load resolves at once.
// The entities are real, one layer set per scene, which is the point.
// ---------------------------------------------------------------------------

type Button = { id: string };
type Cell = { id: string };
type Item = { id: string; level: number };
type Player = { buttons: Button[]; cells: Cell[]; items: Item[] };
type Session = { visits: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const menuButtons = projection({
  name: "menu.buttons",
  layer: "ui",
  from: (player: Player) => player.buttons,
  key: (button: Button) => button.id,
  view: () => []
});

const boardCells = projection({
  name: "board.cells",
  layer: "cells",
  from: (player: Player) => player.cells,
  key: (cell: Cell) => cell.id,
  view: () => []
});

const boardItems = projection({
  name: "board.items",
  layer: "items",
  lift: "lifted",
  from: (player: Player) => player.items,
  key: (item: Item) => item.id,
  view: () => []
});

const hudPanel = projection({
  name: "hud.panel",
  layer: "ui",
  from: (player: Player) => player.buttons,
  key: (button: Button) => button.id,
  view: () => []
});

const homeScene = defineScene("home", {
  bundle: "home",
  layers: { ui: {} },
  projections: [menuButtons],
  music: "home.theme"
});

const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {}, items: { sort: "y" }, lifted: {} },
  projections: [boardCells, boardItems, hudPanel]
});

const home = defineNode({
  rest: true,
  checkpoint: true,
  scene: "home",
  outcomes: { play: type() }
});

const prepare = defineNode({
  scene: "board",
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.visits += 1;

    return out.done();
  }
});

const board = defineNode({
  rest: true,
  scene: "board",
  outcomes: { info: type(), leave: type() }
});

const info = defineNode({ rest: true, over: true, outcomes: { close: type() } });

const main = defineFlow("main", {
  nodes: { home, prepare, board, info },
  start: "home",
  edges: {
    home: { play: "prepare" },
    prepare: { done: "board" },
    board: { info: "info", leave: "home" },
    info: { close: "board" }
  }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  scenes: [homeScene, boardScene],
  projections: [menuButtons, boardCells, boardItems, hudPanel]
});

/** Every `scenes:changed` the probe plugin heard, in order. */
const heard: Events["scenes:changed"][] = [];

const probePlugin = createPlugin("scenesProbe", {
  depends: [scenesPlugin],
  hooks: () => ({
    "scenes:changed": (payload: Events["scenes:changed"]) => {
      heard.push(payload);
    }
  })
});

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many turns to give it.
 */
async function tick(times = 80): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the full screen set plus `scenes` headless and lets the graph settle on "home".
 *
 * @returns The started app.
 */
async function startApp() {
  heard.length = 0;

  const app = createApp({
    plugins: [...screen, boardFeature, probePlugin],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: {
        initialPlayer: {
          buttons: [{ id: "play" }],
          cells: [{ id: "c1" }, { id: "c2" }],
          items: [{ id: "i5", level: 1 }]
        },
        initialSession: { visits: 0 },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  return app;
}

describe("scenes plugin integration — a live walk", () => {
  it("builds the scene of the node the graph rests on", async () => {
    const app = await startApp();

    expect(app.flow.state().path).toBe("home");
    expect(app.scenes.current()).toBe("home");
    expect(app.world.projection.layers()).toEqual([{ name: "ui", sort: "none" }]);
    expect(app.world.projection.entityOf("menu.buttons", "play")).toBeDefined();
    expect(app.world.projection.entityOf("board.items", "i5")).toBeUndefined();
    expect(heard).toEqual([{ from: undefined, to: "home", music: "home.theme" }]);

    await app.stop();
  });

  it("switches to the board, mounts its projections and unmounts the ones of home", async () => {
    const app = await startApp();

    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await tick();

    expect(app.flow.state().path).toBe("board");
    expect(app.scenes.current()).toBe("board");
    expect(app.world.projection.layers()).toEqual([
      { name: "cells", sort: "none" },
      { name: "items", sort: "y" },
      { name: "lifted", sort: "none" },
      { name: "ui", sort: "none" }
    ]);
    expect(app.world.projection.entityOf("board.cells", "c1")).toBeDefined();
    expect(app.world.projection.entityOf("board.items", "i5")).toBeDefined();
    expect(app.world.projection.entityOf("menu.buttons", "play")).toBeUndefined();
    expect(heard).toEqual([
      { from: undefined, to: "home", music: "home.theme" },
      { from: "home", to: "board", music: undefined }
    ]);

    await app.stop();
  });

  it("mounts a HUD projection on the ui layer the scene never declared", async () => {
    const app = await startApp();

    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await tick();

    expect(app.world.projection.entityOf("hud.panel", "play")).toBeDefined();

    await app.stop();
  });

  it("keeps the scene under an over node and puts it back on the way home", async () => {
    const app = await startApp();

    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await tick();
    expect(app.flow.gate.answer({ intent: "info" })).toBe(true);
    await tick();

    expect(app.flow.state().path).toBe("info");
    expect(app.scenes.current()).toBe("board");
    expect(app.world.projection.entityOf("board.cells", "c1")).toBeDefined();
    expect(heard).toHaveLength(2);

    expect(app.flow.gate.answer({ intent: "close" })).toBe(true);
    await tick();
    expect(app.flow.gate.answer({ intent: "leave" })).toBe(true);
    await tick();

    expect(app.scenes.current()).toBe("home");
    expect(app.world.projection.entityOf("menu.buttons", "play")).toBeDefined();
    expect(heard).toHaveLength(3);

    await app.stop();
  });

  it("forgets the scene when the app stops, and the world keeps no entity", async () => {
    const app = await startApp();

    await app.stop();

    expect(app.scenes.current()).toBeUndefined();
    expect(app.world.projection.entityOf("menu.buttons", "play")).toBeUndefined();
  });
});

describe("scenes plugin integration — a fast walk", () => {
  it("switches once at the rest point, and the board is mounted headless", async () => {
    const app = await startApp();

    const state = await app.flow.walk([{ at: "home", intent: "play" }]);

    expect(state.path).toBe("board");
    expect(app.scenes.current()).toBe("board");
    expect(app.world.projection.entityOf("board.cells", "c1")).toBeDefined();
    expect(app.world.projection.entityOf("board.items", "i5")).toBeDefined();
    expect(app.world.projection.entityOf("menu.buttons", "play")).toBeUndefined();
    expect(heard).toEqual([
      { from: undefined, to: "home", music: "home.theme" },
      { from: "home", to: "board", music: undefined }
    ]);

    await app.stop();
  });

  it("restores a checkpoint and builds the scene that bookmark names", async () => {
    const app = await startApp();
    const bookmark = app.flow.bookmark();

    await app.flow.walk([{ at: "home", intent: "play" }]);

    expect(app.scenes.current()).toBe("board");

    await app.flow.restore(bookmark);
    await tick();

    expect(app.scenes.current()).toBe("home");
    expect(app.world.projection.entityOf("menu.buttons", "play")).toBeDefined();

    await app.stop();
  });
});

describe("scenes plugin integration — the static check of flow", () => {
  it("reports a node whose scene no feature declares as one problem of run()", async () => {
    const lost = defineNode({ rest: true, scene: "gone", outcomes: { back: type() } });
    const strayFlow = defineFlow("stray", {
      nodes: { lost },
      start: "lost",
      edges: { lost: { back: "lost" } }
    });
    const strayFeature = defineFeature("stray", {
      flows: [strayFlow],
      scenes: [homeScene],
      projections: []
    });

    const app = createApp({
      plugins: [...screen, strayFeature],
      pluginConfigs: {
        flow: { mainFlow: strayFlow },
        model: {
          initialPlayer: { buttons: [], cells: [], items: [] },
          initialSession: { visits: 0 },
          seed: 1
        }
      }
    });

    await app.start();

    await expect(app.flow.run()).rejects.toThrow(
      'the scene "gone" of node "lost" is not registered'
    );

    await app.stop();
  });
});
