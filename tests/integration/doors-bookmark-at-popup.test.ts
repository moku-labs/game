/**
 * @file A bookmark taken while the info popup of the mini game is open, through the editor doors:
 * `game.bookmark` names the transit node that waits for the popup's answer, and `game.restore`
 * brings the popup back, in a fresh page over the scene the bookmark named and in the same page
 * without a second popup. The game runs with its screen, the fixture's own files behind the assets
 * seam and a fake audio context.
 */

import { commands, run } from "@moku-labs/game/control";
import { read, sources } from "@moku-labs/game/inspect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakeContext,
  installFakeWindow
} from "../../src/plugins/audio/__tests__/fake-audio-context";
import miniGame from "../fixtures/mini-game/index";
import type { MiniGame } from "./mini-helpers";
import { folderIo, frames, readManifest, startOnHome, until } from "./mini-helpers";

/** What the gate of the info popup takes: OK, and the backdrop. */
const popupAnswers = ["ok", "close"];

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON input of a node entered with none.
const noInput = null;

/** The rest point before the popup: Home, entered with no input. */
const homeRest = { path: "home", input: noInput };

/** A node of the ui tree as far as a count needs it: its key and what it holds. */
type Keyed = { readonly key?: string | undefined; readonly children: readonly Keyed[] };

/**
 * Builds the game the dev page runs: the fixture's files and a fake audio context. Not started.
 *
 * @returns The game.
 */
async function buildDevGame(): Promise<MiniGame> {
  installFakeWindow();

  const context = createFakeContext();
  const { app } = miniGame.screen({
    manifest: await readManifest(),
    io: folderIo().io,
    audio: { context: () => context, journal: 200 }
  });

  return app;
}

/**
 * Starts a fresh page and stops before anything is on it: the app is started and its graph runs,
 * but no frame ran yet, so no scene is mounted. A failure of the graph is kept for the test.
 *
 * @returns The game, and where a failure of its graph lands.
 */
async function startFreshPage(): Promise<{ app: MiniGame; loop: { failure?: unknown } }> {
  const app = await buildDevGame();
  const loop: { failure?: unknown } = {};

  await app.start();
  app.flow.run().catch((error: unknown) => {
    loop.failure = error;
  });

  return { app, loop };
}

/**
 * Counts the nodes of a ui tree that carry a key, the node itself included. Every mounted root is
 * one node of the tree, so a popup mounted twice counts twice.
 *
 * @param node - Where the count starts.
 * @param key - The key to count.
 * @returns How many nodes carry it.
 */
function keyed(node: Keyed, key: string): number {
  const own = node.key === key ? 1 : 0;

  return node.children.reduce((count, child) => count + keyed(child, key), own);
}

/**
 * The warnings and errors a game logged, oldest first.
 *
 * @param app - The game.
 * @returns Their events and data.
 */
function complaints(app: MiniGame): { event: string; data: unknown }[] {
  return app.log
    .trace()
    .filter(entry => entry.level === "warn" || entry.level === "error")
    .map(entry => ({ event: entry.event, data: entry.data }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("doors — a bookmark taken while the info popup is open", () => {
  it("comes back in a fresh page with the popup over Home, and OK counts once", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const first = await startOnHome(await buildDevGame());

    await first.flow.walk([{ at: "home", intent: "info" }]);

    const { value: bookmark } = await run(first, commands.bookmark);

    // The node that waits, the scene under it, the rest point before it, and the state committed
    // when the node was entered: its own `opened += 1` is not in it.
    expect(bookmark).toMatchObject({
      path: "info/show",
      input: noInput,
      scene: "home",
      rest: homeRest,
      player: { count: 0 },
      session: { opened: 0 }
    });
    await first.stop();

    const { app, loop } = await startFreshPage();

    expect(app.scenes.current()).toBeUndefined();

    const restored = await run(app, commands.restore, { bookmark });

    expect(restored.value.path).toBe("info/show");
    expect(restored.value.pending.gate).toEqual(popupAnswers);
    expect(restored.state).toMatchObject({ path: "info/show", tainted: true });
    expect(app.scenes.current()).toBe("home");
    // Known: the node runs again from its start, and its spark burst looks for the info button
    // before Home is laid out. One warning, nothing else.
    expect(complaints(app)).toEqual([
      { event: "anim:target-missing", data: { projection: "home.screen", key: "info" } }
    ]);

    // The open gate is not the draw: the popup is on screen one frame later.
    expect(read(app, sources.locate, { key: "infoOk" })).toBeUndefined();
    await frames(app);

    const ok = read(app, sources.locate, { key: "infoOk" });

    expect(ok).toBeDefined();
    expect(ok?.w).toBeGreaterThan(0);
    expect(ok?.h).toBeGreaterThan(0);
    expect(keyed(read(app, sources.ui), "infoScreen")).toBe(1);
    expect(keyed(read(app, sources.ui), "homeScreen")).toBe(1);

    const answered = await run(app, commands.tap, { key: "infoOk" });

    expect(answered.value).toBe(true);
    await until(app, () => read(app, sources.position).path === "home");

    expect(app.model.store.snapshot()).toMatchObject({
      player: { count: 1 },
      session: { opened: 1 }
    });
    expect(loop.failure).toBeUndefined();

    await app.stop();
  });

  it("comes back in the same page with one popup, not two", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = await startOnHome(await buildDevGame());

    await run(app, commands.tap, { key: "info" });
    await until(app, () => read(app, sources.position).path === "info/show");
    await frames(app);

    expect(keyed(read(app, sources.ui), "infoScreen")).toBe(1);

    const { value: bookmark } = await run(app, commands.bookmark);

    expect(bookmark).toMatchObject({ path: "info/show", rest: homeRest });

    const restored = await run(app, commands.restore, { bookmark });

    expect(restored.value.path).toBe("info/show");
    expect(restored.value.pending.gate).toEqual(popupAnswers);
    await frames(app);

    // One popup root, with one OK button in it, over the one Home.
    expect(keyed(read(app, sources.ui), "infoScreen")).toBe(1);
    expect(keyed(read(app, sources.ui), "infoOk")).toBe(1);
    expect(keyed(read(app, sources.ui), "homeScreen")).toBe(1);
    expect(app.scenes.current()).toBe("home");
    expect(read(app, sources.locate, { key: "infoOk" })).toBeDefined();

    await app.stop();
  });
});
