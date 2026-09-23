/**
 * @file What the player of Timber Town hears, headless. The game is composed with its screen but
 * without `audio`, so this file owns the `sfx` kind and writes down every sound the game asks
 * for: the click of every control (the sounds plugin), and never of a panel or a disabled
 * control; the merge, the sawmill pop and the coins; and the one music track of Home and the
 * board.
 */

import { readFile } from "node:fs/promises";
import type { Assets, Flow } from "@moku-labs/game";
import { audioPlugin, createApp, LocalWrite, Tappable, Touchable } from "@moku-labs/game";
import { fakeClock, memory } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { homeScene } from "./merge-game/features/home/scene";
import { splashScene } from "./merge-game/features/splash/scene";
import { isControl, soundsPlugin } from "./merge-game/features/ui/sounds";
import { mainFlow } from "./merge-game/flows/main";
import { screenPlugins, startMoment } from "./merge-game/game";
import type { Player } from "./merge-game/state";
import { startingSession } from "./merge-game/state";
import { generatorId } from "./merge-game/tables";
import { boardScene } from "./merge-game/view/scene";
import { player, withItems } from "./timber-helpers";

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
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
 * Creates the game with its screen and without `audio`.
 *
 * @param start - The player a new save starts from.
 * @param manifest - The committed manifest.
 * @returns The app, not started.
 */
function createQuietApp(start: Player, manifest: Assets.Manifest) {
  return createApp({
    plugins: screenPlugins.filter(plugin => plugin !== audioPlugin),
    config: { referenceLong: 2100 },
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        initialPlayer: start,
        initialSession: startingSession,
        seed: 42
      },
      clock: { source: fakeClock(startMoment) },
      flow: { mainFlow, safeNode: "home" },
      assets: { manifest },
      text: { fonts: { body: "ui.font-body", digits: "ui.font-display" } },
      i18n: { locale: "ru", fallback: "ru" }
    }
  });
}

/** The game as this file drives it, and every sound it asked for, by key, in order. */
type QuietGame = { app: ReturnType<typeof createQuietApp>; heard: string[] };

/**
 * Runs frames of 16 ms, so the screen, the motions and the timelines follow.
 *
 * @param game - The running game.
 * @param count - How many frames.
 */
async function frames(game: QuietGame, count = 6): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    game.app.time.step(16);
    await tick();
  }
}

/**
 * Starts the quiet game on Home, with a recorder on the `sfx` kind.
 *
 * @param start - The player a new save starts from.
 * @returns The game, resting on `home`.
 */
async function startOnHome(start: Player): Promise<QuietGame> {
  const app = createQuietApp(start, await readManifest());
  const heard: string[] = [];

  app.flow.fx.handle("sfx", (descriptor: Flow.Descriptor | Flow.Hint) => {
    heard.push((descriptor.payload as { key: string }).key);
  });
  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  const game = { app, heard };

  await frames(game);
  expect(app.flow.state().path).toBe("home");

  return game;
}

/**
 * The entity of one keyed element, failing the test when it is not there.
 *
 * @param game - The running game.
 * @param key - The key the markup wrote.
 * @returns The entity.
 */
function elementOf(game: QuietGame, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = game.app.ui.find(key);

  expect(entity, key).toBeDefined();

  return entity ?? 0;
}

/**
 * Taps one keyed element and lets the graph and the screen follow.
 *
 * @param game - The running game.
 * @param key - The key of the element to tap.
 * @returns What the tap answered.
 */
async function tap(game: QuietGame, key: string): Promise<boolean> {
  const answered = game.app.input.tap(elementOf(game, key));

  await tick();
  await frames(game);

  return answered;
}

/**
 * Starts on Home and walks onto the board with the Play plank.
 *
 * @param start - The player a new save starts from.
 * @returns The game, resting on `board/awaitIntent`, with what Play made heard cleared.
 */
async function startOnBoard(start: Player): Promise<QuietGame> {
  const game = await startOnHome(start);

  await tap(game, "play");
  await frames(game, 20);
  expect(game.app.flow.state().path).toBe("board/awaitIntent");
  game.heard.length = 0;

  return game;
}

describe("timber-sounds — the click of every control", () => {
  it("clicks once for a tap on a control that names an intent", async () => {
    const game = await startOnHome(player);

    expect(isControl(game.app.world.ecs, elementOf(game, "play"))).toBe(true);
    expect(await tap(game, "play")).toBe(true);
    expect(game.heard).toEqual(["ui.click"]);

    await game.app.stop();
  });

  it("clicks for a button that writes local state, like a settings tab", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");
    game.heard.length = 0;

    const ecs = game.app.world.ecs;
    const tab = [...ecs.query(LocalWrite)][0]?.[0] ?? 0;

    expect(ecs.has(tab, Tappable)).toBe(false);
    game.app.input.tap(tab);

    expect(game.heard).toEqual(["ui.click"]);

    await game.app.stop();
  });

  it("stays silent for a panel that only swallows the tap, and for a disabled control", async () => {
    const game = await startOnHome(player);

    await tap(game, "gift");
    game.heard.length = 0;

    const ecs = game.app.world.ecs;
    const board = elementOf(game, "giftBoard");

    expect([ecs.has(board, Touchable), ecs.has(board, Tappable)]).toEqual([true, false]);
    expect(await tap(game, "giftBoard")).toBe(false);
    expect(game.heard).toEqual([]);

    await game.app.stop();

    // At 100 % the + of the sounds is disabled: it keeps `Touchable` and says nothing.
    const settings = await startOnHome(player);

    await tap(settings, "homeSettings");
    settings.heard.length = 0;

    expect(await tap(settings, "sfxUp")).toBe(false);
    expect(settings.heard).toEqual([]);

    await settings.app.stop();
  });

  it("plays the coins as they land, and one click for the Claim of the daily gift", async () => {
    const game = await startOnHome(player);

    await tap(game, "gift");
    game.heard.length = 0;
    await tap(game, "giftClaim");
    await frames(game, 60);

    expect(game.heard).toEqual(["ui.click", "ui.coins"]);

    await game.app.stop();
  });
});

describe("timber-sounds — the board", () => {
  it("plays board.merge for a legal merge and nothing for a refused one", async () => {
    const game = await startOnBoard(
      withItems([
        { id: "i1", chain: "wood", level: 1, cell: "c1_0" },
        { id: "i2", chain: "wood", level: 1, cell: "c2_0" },
        { id: "i3", chain: "wood", level: 2, cell: "c2_1" }
      ])
    );
    const drag = (from: string, to: string): boolean =>
      game.app.input.drag(
        { projection: "board.items", key: from },
        { projection: "board.items", key: to }
      );

    expect(drag("i2", "i3")).toBe(true);
    await frames(game, 20);

    expect(game.heard).toEqual([]);

    expect(drag("i1", "i2")).toBe(true);
    await frames(game, 20);

    expect(game.heard).toEqual(["board.merge"]);

    await game.app.stop();
  });

  it("plays board.spawn when the sawmill pops a twig", async () => {
    const game = await startOnBoard(player);
    const sawmill = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    expect(game.app.input.tap(sawmill)).toBe(true);
    await frames(game, 20);

    expect(game.heard).toEqual(["ui.click", "board.spawn"]);

    await game.app.stop();
  });
});

describe("timber-sounds — the music and the composition", () => {
  it("plays ui.theme on Home and on the board, the same key, and nothing on the splash", () => {
    expect([homeScene.music, boardScene.music, splashScene.music]).toEqual([
      "ui.theme",
      "ui.theme",
      undefined
    ]);
  });

  it("composes the click plugin with the screen", () => {
    expect(screenPlugins).toContain(soundsPlugin);
  });
});
