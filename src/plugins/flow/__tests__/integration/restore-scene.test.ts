import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, run } from "../../../../control";
import {
  createApp,
  defineGame,
  defineScene,
  exit,
  projection,
  screen,
  type
} from "../../../../index";
import type { Bookmark } from "../../types";

// ---------------------------------------------------------------------------
// Integration: the restore door brings back the scene under a popup. A bookmark
// taken at "settings/open", a rest node with no scene over Home, is restored in
// a fresh app whose graph never entered Home. A bookmark of the board that is
// refused leaves Home expected: the info popup, an over node, opens over Home.
// The real flow, model, world, assets and scenes plugins, in plain Bun:
// `renderer` is inert, `assets` headless.
// ---------------------------------------------------------------------------

type Button = { id: string };
type Player = { buttons: Button[] };
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

const homeScene = defineScene("home", {
  bundle: "home",
  layers: { background: {} },
  projections: [menuButtons]
});

const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: []
});

const home = defineNode({
  rest: true,
  checkpoint: true,
  scene: "home",
  outcomes: { open: type(), play: type(), info: type() }
});

const open = defineNode({ rest: true, outcomes: { close: type() } });

const board = defineNode({ rest: true, scene: "board", outcomes: { leave: type() } });

const info = defineNode({ rest: true, over: true, outcomes: { close: type() } });

const settings = defineFlow("settings", {
  nodes: { open },
  start: "open",
  outcomes: { closed: type() },
  edges: { open: { close: exit("closed") } }
});

const main = defineFlow("main", {
  nodes: { home, settings, board, info },
  start: "home",
  edges: {
    home: { open: "settings", play: "board", info: "info" },
    settings: { closed: "home" },
    board: { leave: "home" },
    info: { close: "home" }
  }
});

const homeFeature = defineFeature("home", {
  flows: [main],
  scenes: [homeScene, boardScene],
  projections: [menuButtons]
});

/** The warn of a rest node that found no scene to mount: the black screen of the bug. */
const noScene = "scenes: a rest node was entered with no scene";

/**
 * Creates and starts a fresh app, the way a new page does, and starts its graph.
 *
 * @returns The started app; its graph has not entered a node yet.
 */
async function startApp() {
  const app = createApp({
    plugins: [...screen, homeFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: {
        initialPlayer: { buttons: [{ id: "play" }] },
        initialSession: { visits: 0 },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);

  return app;
}

/** A started app of the test. */
type App = Awaited<ReturnType<typeof startApp>>;

/**
 * Tells whether the app logged the warn of a rest node with no scene.
 *
 * @param app - The app.
 * @returns True when the warn is in the trace.
 */
const warnedNoScene = (app: App): boolean => app.log.trace().some(entry => entry.event === noScene);

/**
 * Takes a bookmark through the door at the Settings popup over Home.
 *
 * @returns The bookmark, as the editor keeps it.
 */
async function bookmarkAtSettings(): Promise<Bookmark> {
  const app = await startApp();

  await app.flow.walk([]);
  await app.flow.walk([{ at: "home", intent: "open" }]);

  const taken = await run(app, commands.bookmark);

  await app.stop();

  return structuredClone(taken.value);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the restore door brings back the scene", () => {
  it("restores a bookmark at a popup with the scene under it in a fresh app", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const bookmark = await bookmarkAtSettings();

    expect(bookmark).toMatchObject({ path: "settings/open", scene: "home" });

    const app = await startApp();

    await run(app, commands.restore, { bookmark });
    const state = await app.flow.walk([]);

    expect(state.path).toBe("settings/open");
    expect(app.scenes.current()).toBe("home");
    expect(app.world.projection.layers().map(layer => layer.name)).toContain("ui");
    expect(app.world.projection.entityOf("menu.buttons", "play")).toBeDefined();
    expect(warnedNoScene(app)).toBe(false);

    await app.stop();
  });

  it("restores a bookmark without a scene taken at Home", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const first = await startApp();

    await first.flow.walk([]);
    const bookmark: Bookmark = structuredClone(first.flow.bookmark());

    await first.stop();

    const app = await startApp();

    await run(app, commands.restore, { bookmark });
    await app.flow.walk([]);

    expect(app.flow.state().path).toBe("home");
    expect(app.scenes.current()).toBe("home");
    expect(warnedNoScene(app)).toBe(false);

    await app.stop();
  });

  it("warns and mounts nothing when the popup bookmark lost its scene", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const bookmark = await bookmarkAtSettings();

    delete bookmark.scene;

    const app = await startApp();

    await run(app, commands.restore, { bookmark });
    await app.flow.walk([]);

    expect(app.scenes.current()).toBeUndefined();
    expect(warnedNoScene(app)).toBe(true);

    await app.stop();
  });

  it("keeps the mounted scene under the next popup when a bookmark of another scene is refused", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const first = await startApp();

    await first.flow.walk([]);
    await first.flow.walk([{ at: "home", intent: "play" }]);

    const taken = await run(first, commands.bookmark);

    await first.stop();

    expect(taken.value).toMatchObject({ path: "board", scene: "board" });

    // The graph changed since: "board" is a rest node and no checkpoint, so it is refused.
    const bookmark: Bookmark = { ...structuredClone(taken.value), graph: "another-graph" };
    const app = await startApp();

    await app.flow.walk([]);

    await expect(run(app, commands.restore, { bookmark })).rejects.toThrow(
      '[game] The bookmark "board" was made for another graph.\n  Restore the checkpoint "home" instead.'
    );
    expect(app.flow.state().path).toBe("home");
    expect(app.scenes.current()).toBe("home");

    // Normal play goes on: the info popup, an over node, opens over Home.
    const state = await app.flow.walk([{ at: "home", intent: "info" }]);

    expect(state.path).toBe("info");
    expect(app.scenes.current()).toBe("home");

    await app.stop();
  });
});
