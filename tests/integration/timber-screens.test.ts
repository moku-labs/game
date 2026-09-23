/**
 * @file The screens of Timber Town, headless: the splash fills its loading bar from the asset
 * events and moves on to Home by itself, Play on Home opens the board, the board slot hosts every
 * cell, the sawmill and every item, the three order cards enable only the Deliver the rules
 * accept, and the HUD shows the energy of the save. Plain Bun: the renderer is inert and Yoga
 * lays out the same rects as in the browser.
 */

import { readFile } from "node:fs/promises";
import type { Assets, Ui } from "@moku-labs/game";
import { Parent, Tappable, Text, Touchable } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { fillWidth } from "./merge-game/features/splash/view";
import { createScreenGame, startMoment } from "./merge-game/game";
import type { Player, Session } from "./merge-game/state";
import { startingPlayer } from "./merge-game/state";
import { generatorId } from "./merge-game/tables";

/**
 * A board that already carries the level-3 item the first order asks for, and 7 of 10 energy
 * counted at the start moment, so `boot` has no time to catch up and the HUD shows 7.
 */
const readyPlayer: Player = {
  ...startingPlayer,
  merge: {
    ...startingPlayer.merge,
    board: {
      ...startingPlayer.merge.board,
      items: [
        { id: "i1", chain: "wood", level: 3, cell: "c1_0" },
        { id: "i2", chain: "wood", level: 1, cell: "c2_1" }
      ]
    },
    energy: { ...startingPlayer.merge.energy, value: 7, countedAt: startMoment },
    nextItemId: 3
  }
};

/** The game as this file drives it. */
type Game = ReturnType<typeof createScreenGame>;

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/** Yields the whole task queue once: a file read from disk settles in a later task. */
const yieldTask = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, 0);
  });

/**
 * Reads the committed manifest, the file the dev server hands the browser.
 *
 * @returns The parsed manifest.
 */
async function readManifest(): Promise<Assets.Manifest> {
  const text = await readFile(new URL("merge-game/manifest.json", import.meta.url), "utf8");

  return JSON.parse(text) as Assets.Manifest;
}

/** An `AssetsIo` over the files of the fixture, and a latch on the files of one bundle. */
type DiskIo = {
  io: Assets.AssetsIo;
  /** Lets the held files through. */
  release(): void;
};

/**
 * The file seam of `assets` over the disk: every file of the fixture is really read, the images
 * decode to a stand-in and the textures are stand-ins, because the renderer is inert. The files
 * under `held` wait until `release()`, so a test sees the splash halfway.
 *
 * @param held - The path prefix of the files to hold back.
 * @returns The seam and its latch.
 */
function diskIo(held: string): DiskIo {
  const latch: { open: () => void; opened: Promise<void> } = {
    open: () => undefined,
    opened: Promise.resolve()
  };

  latch.opened = new Promise<void>(resolve => {
    latch.open = resolve;
  });

  const io: Assets.AssetsIo = {
    fetch: async url => {
      const path = url.replace(/^\//, "");

      if (path.startsWith(held)) await latch.opened;

      const bytes = await readFile(new URL(`merge-game/${path}`, import.meta.url));

      return new Response(bytes);
    },
    decode: async () => ({ width: 1, height: 1 }) as unknown as ImageBitmap,
    createTexture: () =>
      ({ label: "stand-in" }) as unknown as ReturnType<Assets.AssetsIo["createTexture"]>,
    destroyTexture: () => undefined
  };

  return { io, release: () => latch.open() };
}

/**
 * Starts the game with its screen and its graph.
 *
 * @param game - The game, not started.
 * @returns The same game, started.
 */
async function start(game: Game): Promise<Game> {
  const loop: { failure?: unknown } = {};

  await game.app.start();
  game.app.flow.run().catch((error: unknown) => {
    loop.failure = error;
  });
  await tick();

  if (loop.failure !== undefined) throw loop.failure;

  return game;
}

/**
 * Runs frames until a condition holds, each followed by its microtasks and one task, which is
 * what a file read needs. Fails the test when the condition never holds.
 *
 * @param game - The running game.
 * @param done - The condition to wait for.
 */
async function until(game: Game, done: () => boolean): Promise<void> {
  for (let frame = 0; frame < 200 && !done(); frame += 1) {
    game.app.time.step(16);
    await tick();
    await yieldTask();
  }

  expect(done()).toBe(true);
}

/**
 * Runs a few frames, so the layout and the labels of what just arrived are written.
 *
 * @param game - The running game.
 * @param frames - How many frames.
 */
async function frames(game: Game, frames = 4): Promise<void> {
  for (let frame = 0; frame < frames; frame += 1) {
    game.app.time.step(16);
    await tick();
  }
}

/**
 * The session the graph committed.
 *
 * @param game - The running game.
 * @returns The session tree.
 */
function sessionOf(game: Game): Session {
  return game.app.model.store.snapshot().session as unknown as Session;
}

/**
 * Finds a keyed node in the snapshot of the screen.
 *
 * @param node - The snapshot to search.
 * @param key - The key of the node.
 * @returns The node, or `undefined`.
 */
function nodeOf(node: Ui.UiNode, key: string): Ui.UiNode | undefined {
  if (node.key === key) return node;

  for (const child of node.children) {
    const found = nodeOf(child, key);

    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * The entity of one keyed element, failing the test when it is not there.
 *
 * @param game - The running game.
 * @param key - The key the markup wrote.
 * @returns The entity.
 */
function elementOf(game: Game, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = game.app.ui.find(key);

  expect(entity, key).toBeDefined();

  return entity ?? 0;
}

/**
 * Starts the headless game and walks it onto the board through the screens: the splash lets it
 * through (every bundle counts as loaded without a file seam), and the Play plank of Home is
 * tapped.
 *
 * @param player - The player a new save starts from.
 * @returns The game, resting on `board/awaitIntent` with the board screen laid out.
 */
async function startOnBoard(player: Player): Promise<Game> {
  const game = await start(createScreenGame({ player, manifest: await readManifest() }));

  await frames(game);

  expect(game.app.flow.state().path).toBe("home");
  expect(game.app.input.tap(elementOf(game, "play"))).toBe(true);

  await until(game, () => game.app.flow.state().path === "board/awaitIntent");
  await frames(game);

  return game;
}

describe("timber-screens — the splash", () => {
  it("fills the loading bar from the asset events and moves on to Home when all three are in", async () => {
    const disk = diskIo("features/board/");
    const game = await start(createScreenGame({ manifest: await readManifest(), io: disk.io }));

    // Home and the orders are core bundles and come in; the board waits behind the latch.
    await until(game, () => sessionOf(game).loading > 0.5);

    expect(game.app.flow.state().path).toBe("splash");
    expect(game.app.scenes.current()).toBe("splash");

    const halfway = sessionOf(game).loading;

    expect(halfway).toBeLessThan(1);

    await frames(game);

    expect(nodeOf(game.app.ui.tree(), "loadingFill")?.rect.w).toBe(fillWidth(halfway));
    expect(game.app.world.ecs.get(elementOf(game, "loadingLabel"), Text)?.resolved).toBe(
      "Загрузка…"
    );

    disk.release();
    await until(game, () => game.app.flow.state().path === "home");

    expect(sessionOf(game).loading).toBe(1);
    expect(game.app.scenes.current()).toBe("home");
    expect(game.app.assets.isLoaded("board")).toBe(true);

    await game.app.stop();
  });

  it("lets a game without the file seam through to Home at once", async () => {
    const game = await start(createScreenGame({ manifest: await readManifest() }));

    await frames(game);

    expect(game.app.flow.state().path).toBe("home");
    expect(sessionOf(game).loading).toBe(1);
    // The daily gift waits, so its button carries the red "1".
    expect(game.app.world.ecs.get(elementOf(game, "giftBadgeCount"), Text)?.resolved).toBe("1");

    await game.app.stop();
  });
});

describe("timber-screens — the board screen", () => {
  it("hosts every cell, the sawmill and every item in the board slot", async () => {
    const game = await startOnBoard(readyPlayer);
    const slot = elementOf(game, "boardSlot");
    const projection = game.app.world.projection;
    const hosted = [
      ...projection.entitiesOf("board.cells"),
      ...projection.entitiesOf("board.generators"),
      ...projection.entitiesOf("board.items")
    ];

    expect(hosted).toHaveLength(9 + 1 + 2);
    expect(hosted.map(entity => game.app.world.ecs.get(entity, Parent)?.entity)).toEqual(
      hosted.map(() => slot)
    );
    // The slot is the tray at its natural 970 units, scaled down into what the bars leave.
    expect(nodeOf(game.app.ui.tree(), "boardSlot")).toMatchObject({
      rect: { w: 970, h: 970 },
      style: { nineSlice: "board.board-tray" }
    });

    await game.app.stop();
  });

  it("draws the coin counter inside the coin pill of the HUD", async () => {
    const game = await startOnBoard(readyPlayer);
    const counter = game.app.world.projection.entityOf("hud.coins", "coins") ?? 0;

    expect(game.app.world.ecs.get(counter, Parent)?.entity).toBe(elementOf(game, "coinPill"));

    await game.app.stop();
  });

  it("shows three order cards and enables only the Deliver the rules accept", async () => {
    const game = await startOnBoard(readyPlayer);
    const ecs = game.app.world.ecs;

    expect(["card0", "card1", "card2"].map(key => elementOf(game, key) > 0)).toEqual([
      true,
      true,
      true
    ]);
    // The plank on the board fills the first order; nothing fills the log or the crate.
    expect(ecs.has(elementOf(game, "deliver0"), Tappable)).toBe(true);
    expect(ecs.has(elementOf(game, "deliver1"), Tappable)).toBe(false);
    expect(ecs.has(elementOf(game, "deliver1"), Touchable)).toBe(true);
    expect(ecs.has(elementOf(game, "deliver2"), Tappable)).toBe(false);
    expect(nodeOf(game.app.ui.tree(), "deliver1")?.state.disabled).toBe(true);
    expect(nodeOf(game.app.ui.tree(), "card0")?.state.selected).toBe(true);
    expect(game.app.input.tap(elementOf(game, "deliver1"))).toBe(false);
    expect(ecs.get(elementOf(game, "card1Name"), Text)?.resolved).toBe("Бревно");
    expect(ecs.get(elementOf(game, "card2Coins"), Text)?.resolved).toBe("60");

    await game.app.stop();
  });

  it("shows the energy and the sawmill charges of the save", async () => {
    const game = await startOnBoard(readyPlayer);
    const ecs = game.app.world.ecs;

    expect(ecs.get(elementOf(game, "energyPillText"), Text)?.resolved).toBe("7/10");
    expect(ecs.get(elementOf(game, "infoCharges"), Text)?.resolved).toBe("4/4");
    expect(ecs.get(elementOf(game, "infoName"), Text)?.resolved).toBe("Лесопилка");

    const generator = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    expect(game.app.input.tap(generator)).toBe(true);
    await until(game, () => ecs.get(elementOf(game, "infoCharges"), Text)?.resolved === "3/4");

    expect(ecs.get(elementOf(game, "energyPillText"), Text)?.resolved).toBe("6/10");

    await game.app.stop();
  });

  it("goes back to Home from the home button of the HUD", async () => {
    const game = await startOnBoard(readyPlayer);

    expect(game.app.input.tap(elementOf(game, "home"))).toBe(true);
    await until(game, () => game.app.flow.state().path === "home");

    expect(game.app.scenes.current()).toBe("home");

    await game.app.stop();
  });
});
