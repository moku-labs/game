/**
 * @file The headless half of the V3 exit criterion: the fixture merge game with its interface.
 * The HUD is laid out into entities, the gear answers the gate, the Deliver of an order card
 * delivers an order through the reward popup, the coin counter arrives at the committed sum, and
 * a language switch re-resolves the labels. Plain Bun: the renderer is inert, the audio context is locked, and Yoga
 * lays the same rects out as it would in the browser.
 */

import { readFile } from "node:fs/promises";
import type { Assets, Ui } from "@moku-labs/game";
import { Text } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { createScreenGame } from "./merge-game/game";
import type { Player } from "./merge-game/state";
import { startingPlayer } from "./merge-game/state";

/** A board that already carries the level-3 item the first order asks for. */
const readyPlayer: Player = {
  ...startingPlayer,
  merge: {
    ...startingPlayer.merge,
    board: {
      ...startingPlayer.merge.board,
      items: [{ id: "i1", chain: "wood", level: 3, cell: "c1_0" }]
    },
    nextItemId: 2
  }
};

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 80): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Yields the whole task queue once, which is what a real load needs: the language module of a
 * locale is fetched, and a fetch is never done inside the microtasks of one frame.
 */
const yieldToLoad = (): Promise<void> =>
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

/** The game with its interface, as this file drives it. */
type Interface = Awaited<ReturnType<typeof startBoard>>;

/**
 * Runs frames through the loop, each one followed by the microtasks it released. It is what a
 * browser does between two paints, and what every motion and every effect of a node needs.
 *
 * @param game - The running game.
 * @param frames - How many frames to run.
 */
async function stepFrames(game: Interface, frames = 30): Promise<void> {
  for (let index = 0; index < frames; index += 1) {
    game.app.time.step(16);
    await tick(20);
    await yieldToLoad();
  }
}

/**
 * Runs frames until a condition holds, for what waits on real I/O (a language module import) and
 * so takes a varying number of frames. Fails the test when it never holds.
 *
 * @param game - The running game.
 * @param done - The condition to wait for.
 */
async function stepUntil(game: Interface, done: () => boolean): Promise<void> {
  for (let frame = 0; frame < 200 && !done(); frame += 1) await stepFrames(game, 1);

  expect(done()).toBe(true);
}

/**
 * Starts the game with its interface and walks it onto the board: the loading plugin lets the
 * splash through to Home at once (headless, every bundle counts as loaded), and Home answers
 * `play`.
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

  expect(game.app.flow.state().path).toBe("home");
  expect(game.app.flow.gate.answer({ intent: "play" })).toBe(true);
  await tick();
  game.app.time.step(16);
  await tick();
  game.app.time.step(16);

  return game;
}

/**
 * The entity of one keyed element of the interface.
 *
 * @param game - The running game.
 * @param key - The key the markup wrote.
 * @returns The entity, or zero when nothing carries that key.
 */
function elementOf(game: Interface, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  return game.app.ui.find(key) ?? 0;
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
 * The string a label resolved to.
 *
 * @param game - The running game.
 * @param entity - The entity the label sits on.
 * @returns What `text` wrote into `Text.resolved`.
 */
function resolvedOf(game: Interface, entity: number): string {
  return game.app.world.ecs.get(entity, Text)?.resolved ?? "";
}

describe("interface-merge — the HUD on the board", () => {
  it("lays the HUD row out into entities with rects", async () => {
    const game = await startBoard(readyPlayer);
    const tree = game.app.ui.tree();
    const bar = nodeOf(tree, "hudRow") ?? tree;

    expect(bar.children.map(child => child.key)).toEqual([
      "home",
      "coinPill",
      "energyPill",
      "settings"
    ]);
    expect(bar.rect.w).toBe(1080);
    expect(bar.children.every(child => child.rect.w > 0 && child.rect.h > 0)).toBe(true);
    expect(game.app.world.projection.entityOf("hud", "settings")).toBe(elementOf(game, "settings"));

    await game.app.stop();
  });

  it("opens the settings when the gear is tapped and closes them again", async () => {
    const game = await startBoard(readyPlayer);

    expect(game.app.input.tap(elementOf(game, "settings"))).toBe(true);
    await stepFrames(game, 6);

    expect(game.app.flow.state().path).toBe("board/settings/open");
    expect(elementOf(game, "settingsBoardClose")).toBeGreaterThan(0);
    expect(resolvedOf(game, elementOf(game, "settingsBoardTitle"))).toBe("Настройки");

    expect(game.app.input.tap(elementOf(game, "settingsBoardClose"))).toBe(true);
    await stepFrames(game, 6);

    expect(game.app.flow.state().path).toBe("board/awaitIntent");
    expect(game.app.ui.find("settingsBoardClose")).toBeUndefined();

    await game.app.stop();
  });

  it("turns the music down through the volume button and commits it", async () => {
    const game = await startBoard(readyPlayer);

    game.app.input.tap(elementOf(game, "settings"));
    await stepFrames(game, 6);

    expect(game.app.input.tap(elementOf(game, "musicDown"))).toBe(true);
    await stepFrames(game, 6);

    expect(game.app.model.store.snapshot().player).toMatchObject({
      settings: { audio: { music: 0.5 } }
    });
    // The step commits and comes back to the same popup.
    expect(game.app.flow.state().path).toBe("board/settings/open");

    await game.app.stop();
  });

  it("switches the language through the tab of the settings screen", async () => {
    const game = await startBoard(readyPlayer);

    game.app.input.tap(elementOf(game, "settings"));
    await stepFrames(game, 6);

    // The tab is local state: `input.tap` answers no gate, the popup simply swaps its pane.
    game.app.input.tap(elementOf(game, "tabLanguage"));
    await stepFrames(game, 4);

    expect(game.app.flow.state().path).toBe("board/settings/open");
    expect(resolvedOf(game, elementOf(game, "languageEnglishLabel"))).toBe("English");

    expect(game.app.input.tap(elementOf(game, "languageEnglish"))).toBe(true);
    // The language module is fetched, so the node waits for a real import before it commits: the
    // number of frames that takes varies, so the test waits for the commit, then lets labels settle.
    await stepUntil(
      game,
      () => game.app.i18n.locale() === "en" && game.app.flow.state().path === "board/settings/open"
    );
    await stepFrames(game, 6);

    expect(game.app.i18n.locale()).toBe("en");
    expect(game.app.model.store.snapshot().player).toMatchObject({ settings: { locale: "en" } });
    expect(game.app.flow.state().path).toBe("board/settings/open");
    expect(resolvedOf(game, elementOf(game, "settingsBoardTitle"))).toBe("Settings");
    expect(resolvedOf(game, elementOf(game, "card0Title"))).toBe("Order #1");

    await game.app.stop();
  });

  it("keeps the audio context locked without a gesture of a real browser", async () => {
    const game = await startBoard(readyPlayer);

    expect(game.app.audio.unlocked()).toBe(false);

    await game.app.stop();
  });
});

describe("interface-merge — the order delivered through the HUD", () => {
  it("delivers the order, claims the reward and shows the coins on the counter", async () => {
    const game = await startBoard(readyPlayer);
    const deliver = elementOf(game, "deliver0");

    expect(game.app.world.ecs.get(deliver, Text)).toBeUndefined();
    expect(game.app.input.tap(deliver)).toBe(true);
    // The node stamps the card "Готово!" before the popup opens (about 0.7 s), and the label of
    // an element that arrived this frame is resolved by `text` in the next one.
    await stepFrames(game, 70);

    // The reward popup is up and the node waits for its one outcome.
    expect(game.app.flow.state().path).toBe("afterOrder/show");
    expect(elementOf(game, "rewardClaim")).toBeGreaterThan(0);
    expect(resolvedOf(game, elementOf(game, "rewardCoins"))).toBe("+25");

    // The coins are still parked: the wallet is paid when the player takes the reward, so the
    // counter — which is not a ui element but the projection the label binds to — stands still.
    const counter = game.app.world.projection.entityOf("hud.coins", "coins") ?? 0;

    expect(resolvedOf(game, counter)).toBe("0");
    expect(game.app.model.store.snapshot().player).toMatchObject({
      pendingCoins: 25,
      merge: { wallet: { coins: 0 } }
    });

    expect(game.app.input.tap(elementOf(game, "rewardClaim"))).toBe(true);
    // The claim commits the coins and releases the `coins.fly` hint, so the counter waits for the
    // flight before it rolls. Four frames in it still shows what the player had.
    await stepFrames(game, 4);

    expect(resolvedOf(game, counter)).toBe("0");

    await stepFrames(game, 60);

    expect(resolvedOf(game, counter)).toBe("25");

    expect(game.app.model.store.snapshot().player).toMatchObject({
      claimed: ["planks"],
      merge: { board: { items: [] }, wallet: { coins: 25 } }
    });
    // The reward hands the player back to the board, so the HUD is still there to show the coins.
    expect(game.app.flow.state().path).toBe("board/awaitIntent");
    expect(elementOf(game, "card0")).toBeGreaterThan(0);

    await game.app.stop();
  });
});

describe("interface-merge — the language", () => {
  it("re-resolves every label when the locale changes", async () => {
    const game = await startBoard(readyPlayer);
    const order = elementOf(game, "card0Title");

    expect(resolvedOf(game, order)).toBe("Заказ #1");

    await game.app.i18n.setLocale("en");
    await stepFrames(game, 2);

    expect(game.app.i18n.locale()).toBe("en");
    expect(resolvedOf(game, order)).toBe("Order #1");

    await game.app.stop();
  });
});
