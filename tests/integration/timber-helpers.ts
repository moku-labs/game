/**
 * @file What the headless Timber Town tests share: the game with its screen started on Home or on
 * the board, frames, taps on keyed elements, and the readers of the screen and the save. Plain
 * Bun: the renderer is inert, Yoga lays out the real rects, the flow runner and `anim` run for
 * real.
 */
import { readFile } from "node:fs/promises";
import type { Assets, Model, Ui } from "@moku-labs/game";
import { Text } from "@moku-labs/game";
import { expect } from "vitest";
import { createScreenGame, startMoment } from "./merge-game/game";
import type { Player } from "./merge-game/state";
import { startingPlayer } from "./merge-game/state";

/** The game as the Timber Town tests drive it. */
export type Game = ReturnType<typeof createScreenGame>;

/** One entity of `world.ecs.snapshot()`, as far as the tests read it. */
export type WorldEntity = {
  id: number;
  owner: { kind: string; name: string };
  components: Record<string, Model.Json>;
};

/** What `world.ecs.snapshot()` answers, as far as the tests read it. */
type WorldSnapshot = { entities: WorldEntity[] };

/**
 * Tells a plain object from the other JSON values.
 *
 * @param value - A JSON value.
 * @returns True for an object that is not an array.
 * @example
 * ```ts
 * isRecord({ a: 1 }); // true
 * ```
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks the committed player has the shape the tests read: the rules' state and the settings.
 *
 * @param value - The player root of the model snapshot.
 * @returns True when it can be read as the fixture's `Player`.
 */
function isPlayer(value: unknown): value is Player {
  return isRecord(value) && isRecord(value.merge) && isRecord(value.settings);
}

/**
 * Checks the world snapshot lists entities with an id, an owner and components.
 *
 * @param value - What `world.ecs.snapshot()` answered.
 * @returns True when it can be read as a `WorldSnapshot`.
 */
function isWorldSnapshot(value: unknown): value is WorldSnapshot {
  if (!isRecord(value) || !Array.isArray(value.entities)) return false;

  return value.entities.every(
    entity =>
      isRecord(entity) &&
      typeof entity.id === "number" &&
      isRecord(entity.owner) &&
      isRecord(entity.components)
  );
}

/**
 * A player with a plank on the board, which the first order takes, and a twig; seven of ten
 * energy counted at the start moment, so `boot` has nothing to catch up.
 */
export const player: Player = {
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

/**
 * The same player with other items on the board.
 *
 * @param items - The items on the board.
 * @returns The player.
 */
export function withItems(items: Player["merge"]["board"]["items"]): Player {
  return {
    ...player,
    merge: {
      ...player.merge,
      board: { ...player.merge.board, items },
      nextItemId: items.length + 1
    }
  };
}

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many microtasks to give up.
 */
export async function tick(times = 40): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Yields the whole task queue once: the English strings are a module fetched on demand.
 *
 * @returns A promise that settles in the next task.
 */
function yieldTask(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

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
 * Runs frames until a condition holds, each followed by its microtasks and one task. Fails the
 * test when the condition never holds.
 *
 * @param game - The running game.
 * @param done - The condition to wait for.
 */
export async function until(game: Game, done: () => boolean): Promise<void> {
  for (let frame = 0; frame < 200 && !done(); frame += 1) {
    game.app.time.step(16);
    await tick();
    await yieldTask();
  }

  expect(done()).toBe(true);
}

/**
 * Runs frames of 16 ms, so the layout, the labels and the motions of what just arrived are written.
 *
 * @param game - The running game.
 * @param count - How many frames.
 */
export async function frames(game: Game, count = 6): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    game.app.time.step(16);
    await tick();
  }
}

/**
 * Starts the game with its screen and its graph, and waits for Home: headless, every bundle
 * counts as loaded at once, so the splash lets the graph through by itself.
 *
 * @param start - The player a new save starts from.
 * @returns The game, resting on `home` with the Home screen laid out.
 */
export async function startOnHome(start: Player): Promise<Game> {
  const game = createScreenGame({ player: start, manifest: await readManifest() });
  const loop: { failure?: unknown } = {};

  await game.app.start();
  game.app.flow.run().catch((error: unknown) => {
    loop.failure = error;
  });
  await tick();

  if (loop.failure !== undefined) throw loop.failure;

  await frames(game);
  expect(game.app.flow.state().path).toBe("home");

  return game;
}

/**
 * Starts the game and walks it onto the board with the Play plank of Home.
 *
 * @param start - The player a new save starts from.
 * @returns The game, resting on `board/awaitIntent` with the board screen laid out.
 */
export async function startOnBoard(start: Player): Promise<Game> {
  const game = await startOnHome(start);

  expect(game.app.input.tap(elementOf(game, "play"))).toBe(true);
  await until(game, () => game.app.flow.state().path === "board/awaitIntent");
  await frames(game);

  return game;
}

/**
 * The entity of one keyed element, failing the test when it is not there.
 *
 * @param game - The running game.
 * @param key - The key the markup wrote.
 * @returns The entity.
 */
export function elementOf(game: Game, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = game.app.ui.find(key);

  expect(entity, key).toBeDefined();

  return entity ?? 0;
}

/**
 * Whether a keyed element is on the screen, exiting ones left out.
 *
 * @param game - The running game.
 * @param key - The key the markup wrote.
 * @returns True while the element is live.
 */
export function shows(game: Game, key: string): boolean {
  // eslint-disable-next-line unicorn/no-array-callback-reference, unicorn/prefer-array-some -- `ui.find` takes a key; it is not `Array.prototype.find`.
  return game.app.ui.find(key) !== undefined;
}

/**
 * Taps one keyed element and lets the graph and the screen follow.
 *
 * @param game - The running game.
 * @param key - The key of the element to tap.
 */
export async function tap(game: Game, key: string): Promise<void> {
  expect(game.app.input.tap(elementOf(game, key)), key).toBe(true);
  await tick();
  await frames(game);
}

/**
 * The string a label resolved to.
 *
 * @param game - The running game.
 * @param key - The key of the label.
 * @returns What `text` wrote into `Text.resolved`.
 */
export function resolvedOf(game: Game, key: string): string {
  return game.app.world.ecs.get(elementOf(game, key), Text)?.resolved ?? "";
}

/**
 * Finds a keyed node in the snapshot of the screen.
 *
 * @param node - The snapshot to search.
 * @param key - The key of the node.
 * @returns The node, or `undefined`.
 */
export function nodeOf(node: Ui.UiNode, key: string): Ui.UiNode | undefined {
  if (node.key === key) return node;

  for (const child of node.children) {
    const found = nodeOf(child, key);

    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * Every node of a subtree, the top included.
 *
 * @param node - The top of the subtree.
 * @returns The nodes, depth first.
 */
function flat(node: Ui.UiNode): Ui.UiNode[] {
  return [node, ...node.children.flatMap(child => flat(child))];
}

/**
 * Every node of one popup, read from the live snapshot.
 *
 * @param game - The running game.
 * @param key - The key of the popup's screen root.
 * @returns The nodes of that popup, depth first.
 */
export function popupNodes(game: Game, key: string): Ui.UiNode[] {
  const root = nodeOf(game.app.ui.tree(), key);

  expect(root, key).toBeDefined();

  return root === undefined ? [] : flat(root);
}

/**
 * The committed player.
 *
 * @param game - The running game.
 * @returns The player tree.
 */
export function playerOf(game: Game): Player {
  const player: unknown = game.app.model.store.snapshot().player;

  if (!isPlayer(player)) throw new Error("the committed player is not the fixture's Player");

  return player;
}

/**
 * The entities `anim` spawned for a timeline that is still running.
 *
 * @param game - The running game.
 * @returns Their snapshots.
 */
export function spawnedByAnim(game: Game): WorldEntity[] {
  const snapshot: unknown = game.app.world.ecs.snapshot();

  if (!isWorldSnapshot(snapshot)) throw new Error("the world snapshot lists no readable entities");

  return snapshot.entities.filter(
    entity => entity.owner.kind === "plugin" && entity.owner.name === "anim"
  );
}

/**
 * The texture of a spawned sprite.
 *
 * @param entity - The snapshot of the entity.
 * @returns Its texture key, or `undefined` for an entity without a sprite.
 */
export function textureOf(entity: WorldEntity): string | undefined {
  return (entity.components.Sprite as { texture?: string } | undefined)?.texture;
}

/**
 * The flying coins among the spawned entities.
 *
 * @param game - The running game.
 * @returns How many coins are in the air.
 */
export function coinsInFlight(game: Game): number {
  return spawnedByAnim(game).filter(entity => textureOf(entity) === "ui.icon-coin").length;
}

/**
 * The number the coin counter shows.
 *
 * @param game - The running game.
 * @returns What its label resolved to.
 */
export function counterOf(game: Game): string {
  const counter = game.app.world.projection.entityOf("hud.coins", "coins") ?? 0;

  return game.app.world.ecs.get(counter, Text)?.resolved ?? "";
}
