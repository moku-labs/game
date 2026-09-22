/**
 * @file The headless half of the V2 exit criterion: the fixture merge game with its screen
 * composed. The board becomes entities in their layers, a scripted drag merges two items, and the
 * same game still plays to the end in plain Bun. The browser half is driven by the e2e station.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Assets, Flow, Model } from "@moku-labs/game";
import { Transform } from "@moku-labs/game";
import { createHeadless } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { createScreenGame } from "./merge-game/game";
import type { Player } from "./merge-game/state";
import { startingPlayer } from "./merge-game/state";
import { generatorId } from "./merge-game/tables";
import { Item } from "./merge-game/view/components";

const runCommand = promisify(execFile);

/** The repository root, so the scanner is started with the cwd a game would use. */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The fixture game as the scanner walks it: the folder that holds `features/`. */
const gameRoot = "tests/integration/merge-game";

/** One entity of `world.ecs.snapshot()`, as far as this test reads it. */
type WorldEntity = {
  id: number;
  owner: { kind: string; name: string };
  components: Record<string, Model.Json>;
};

/** What `world.ecs.snapshot()` answers, as far as this test reads it. */
type WorldSnapshot = { mode: string; entities: WorldEntity[] };

/** One tap on the only generator of the game. */
const tap: Flow.RouteStep = { at: "board/awaitIntent", intent: "tap", payload: { generatorId } };

/** Drag the item on `from` onto the item on `to`. */
const mergeStep = (from: string, to: string): Flow.RouteStep => ({
  at: "board/awaitIntent",
  intent: "merge",
  payload: { from, to }
});

/** Open the board, spend the generator's four charges, merge them up to one level-3 item, give it. */
const untilOrder: Flow.RouteStep[] = [
  { at: "home", intent: "play" },
  tap,
  tap,
  tap,
  tap,
  mergeStep("c0_0", "c1_0"),
  mergeStep("c0_1", "c1_1"),
  mergeStep("c1_0", "c1_1"),
  { at: "board/awaitIntent", intent: "give", payload: { item: "i4", order: 0 } }
];

/** The reward popup the finished order opened. */
const claim: Flow.RouteStep = { at: "afterOrder/show", intent: "claim" };

/** A board that already carries two equal items and one of the next level. */
const preparedPlayer: Player = {
  ...startingPlayer,
  merge: {
    ...startingPlayer.merge,
    board: {
      ...startingPlayer.merge.board,
      items: [
        { id: "i1", chain: "wood", level: 1, cell: "c1_0" },
        { id: "i2", chain: "wood", level: 1, cell: "c2_0" },
        { id: "i3", chain: "wood", level: 2, cell: "c1_1" }
      ]
    },
    nextItemId: 4
  }
};

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 80): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Reads the committed manifest, the file the dev server hands the browser.
 *
 * @returns The parsed manifest.
 */
async function readManifest(): Promise<Assets.Manifest> {
  const text = await readFile(new URL("merge-game/manifest.json", import.meta.url), "utf8");

  return JSON.parse(text) as Assets.Manifest;
}

/**
 * Counts the entities of the world by the layer the projection put them in.
 *
 * @param snapshot - What `world.ecs.snapshot()` answered.
 * @returns How many entities each layer carries.
 */
function countByLayer(snapshot: Model.Json): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const entity of (snapshot as unknown as WorldSnapshot).entities) {
    const layer = entity.components.Layer;

    if (typeof layer !== "object" || layer === null || Array.isArray(layer)) continue;

    const name = layer.name;

    if (typeof name === "string") counts[name] = (counts[name] ?? 0) + 1;
  }

  return counts;
}

/**
 * Starts the game live with the screen composed and walks it onto the board.
 *
 * @param player - The player a new save starts from.
 * @returns The started game, resting on `board/awaitIntent`.
 */
async function startBoard(player: Player) {
  const game = createScreenGame({ player, manifest: await readManifest() });
  const loop: { failure?: unknown } = {};

  await game.app.start();
  game.app.flow.run().catch((error: unknown) => {
    loop.failure = error;
  });
  await tick();

  if (loop.failure !== undefined) throw loop.failure;

  expect(game.app.flow.gate.answer({ intent: "play" })).toBe(true);
  await tick();
  game.app.time.step(16);

  return game;
}

describe("screen-merge — the board as entities", () => {
  it("mounts the scene of the resting node with one entity per cell and per item", async () => {
    const { app } = await startBoard(preparedPlayer);

    expect(app.scenes.current()).toBe("board");
    expect(app.world.projection.layers()).toEqual([
      { name: "background", sort: "none" },
      { name: "cells", sort: "none" },
      { name: "items", sort: "y" },
      { name: "lifted", sort: "none" },
      { name: "fx", sort: "none" }
    ]);
    // Nine cells, three items and the generator, which is drawn among the items.
    expect(countByLayer(app.world.ecs.snapshot())).toEqual({ cells: 9, items: 4 });
    expect(app.world.projection.entityOf("board.cells", "c1_0")).toBeDefined();
    expect(app.world.projection.entityOf("board.items", "i1")).toBeDefined();
    expect(app.world.projection.entityOf("board.generators", generatorId)).toBeDefined();

    await app.stop();
  });

  it("merges two equal items when one is dragged onto the other", async () => {
    const { app } = await startBoard(preparedPlayer);

    expect(
      app.input.drag(
        { projection: "board.items", key: "i1" },
        { projection: "board.items", key: "i2" }
      )
    ).toBe(true);

    await tick();
    app.time.step(16);

    expect(app.model.store.snapshot().player).toMatchObject({
      merge: {
        board: {
          items: [
            { id: "i2", level: 2, cell: "c2_0" },
            { id: "i3", level: 2, cell: "c1_1" }
          ]
        }
      }
    });
    expect(app.world.projection.entityOf("board.items", "i1")).toBeUndefined();

    const survivor = app.world.projection.entityOf("board.items", "i2") ?? 0;

    expect(app.world.ecs.get(survivor, Item)).toEqual({ chain: "wood", level: 2, cell: "c2_0" });
    expect(countByLayer(app.world.ecs.snapshot())).toMatchObject({ cells: 9 });

    await app.stop();
  });

  it("keeps both items when one is dropped on an item of another level", async () => {
    const { app } = await startBoard(preparedPlayer);
    const before = app.model.store.snapshot().player;

    expect(
      app.input.drag(
        { projection: "board.items", key: "i2" },
        { projection: "board.items", key: "i3" }
      )
    ).toBe(true);

    await tick();
    app.time.step(16);

    expect(app.model.store.snapshot().player).toEqual(before);
    expect(app.world.projection.entityOf("board.items", "i2")).toBeDefined();
    expect(app.world.projection.entityOf("board.items", "i3")).toBeDefined();
    expect(countByLayer(app.world.ecs.snapshot())).toEqual({ cells: 9, items: 4 });

    await app.stop();
  });

  it("spawns one more item entity when the generator is tapped", async () => {
    const { app } = await startBoard(startingPlayer);

    expect(countByLayer(app.world.ecs.snapshot())).toEqual({ cells: 9, items: 1 });

    const generator = app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    expect(app.input.tap(generator)).toBe(true);

    await tick();
    app.time.step(16);

    expect(app.world.projection.entityOf("board.items", "i1")).toBeDefined();
    expect(countByLayer(app.world.ecs.snapshot())).toEqual({ cells: 9, items: 2 });

    await app.stop();
  });
});

describe("screen-merge — the fast walk", () => {
  it("plays the whole game to the end with the screen composed", async () => {
    const { app } = createScreenGame({ manifest: await readManifest() });
    const game = await createHeadless(app);

    expect(game.state().path).toBe("home");

    const board = await game.walk(untilOrder);

    expect(board.path).toBe("afterOrder/show");
    expect(app.scenes.current()).toBe("board");

    const home = await game.walk([claim]);

    expect(home.path).toBe("home");
    expect(app.model.store.snapshot().player).toMatchObject({
      claimed: ["planks"],
      merge: { board: { items: [] }, wallet: { coins: 25 } }
    });

    await game.stop();
  });

  it("sets the picture with no motion while the world is fast", async () => {
    const { app } = createScreenGame({ manifest: await readManifest() });
    const game = await createHeadless(app);

    await game.walk([{ at: "home", intent: "play" }, tap]);

    expect(app.world.ecs.mode()).toBe("fast");

    const item = app.world.projection.entityOf("board.items", "i1") ?? 0;

    // The enter motion would start the view at scale 0 on the generator; fast mode skips it.
    expect(app.world.ecs.get(item, Transform)).toEqual({ x: 300, y: 720, rotation: 0, scale: 1 });

    await game.stop();
  });
});

describe("screen-merge — the generated asset keys", () => {
  it("has a manifest and a key module the scanner would write again", async () => {
    const { stdout } = await runCommand(
      "bun",
      [
        "src/assets-scan.ts",
        "--root",
        gameRoot,
        "--manifest",
        `${gameRoot}/manifest.json`,
        "--keys",
        `${gameRoot}/generated/assets.ts`,
        "--check"
      ],
      { cwd: repoRoot }
    );

    expect(stdout).toContain("up to date");
  }, 60_000);
});
