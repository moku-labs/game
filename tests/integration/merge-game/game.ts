/**
 * @file The composition root of the fixture merge game: two `createApp` calls, one without the
 * screen and one with it. A shipped game adds `onStart: ctx => { ctx.flow.run().catch(showFatal); }`;
 * here the headless runner owns `run()`, so a fatal error reaches the test instead of a handler.
 */
import type { Assets, Model } from "@moku-labs/game";
import { audioPlugin, createApp, screen } from "@moku-labs/game";
import { fakeClock, memory } from "@moku-labs/game/testing";
import { hudFeature } from "./features/hud";
import { ordersFeature } from "./features/orders";
import { settingsFeature } from "./features/settings";
import { settingsLocalePlugin } from "./features/settings/plugin";
import { mainFlow } from "./flows/main";
import { rewardFeature } from "./flows/reward";
import type { Player } from "./state";
import { startingPlayer, startingSession } from "./state";
import { boardView } from "./view";

/**
 * Reads the volumes the player chose out of the committed save. `audio` calls it on every commit,
 * which is why no node ever touches a gain.
 *
 * @param player - The committed player tree, as plain JSON.
 * @returns The gain of every bus.
 * @example
 * ```ts
 * volumesOf(startingPlayer as unknown as Model.Json); // { master: 1, music: 0.6, sfx: 1 }
 * ```
 */
export function volumesOf(player: Model.Json): Player["settings"]["audio"] {
  return (player as unknown as Player).settings.audio;
}

/** The save seam, recording every call it gets. */
export type Provider = ReturnType<typeof memory>;

/** The time source the test steers. */
export type Clock = ReturnType<typeof fakeClock>;

/** What a test may pin when it creates the game. */
export type GameOptions = {
  /** The save seam. A fresh in-memory provider by default: a new player. */
  provider?: Provider;
  /** The time source. A fake clock at `startMoment` by default. */
  clock?: Clock;
  /** The rng seed. Fixed, so two runs of one route draw the same items. */
  seed?: number;
  /** The player a new save starts from. */
  player?: Player;
};

/** The game and the two seams a test holds on to. */
export type Game = {
  app: ReturnType<typeof createApp>;
  clock: Clock;
  provider: Provider;
};

/** Where the fake clock starts. Not zero, so a stored moment of zero is really in the past. */
export const startMoment = 1_000_000;

/**
 * Creates the game.
 *
 * @param options - The seams a test pins: provider, clock, seed and starting player.
 * @returns The app and the seams behind it.
 * @example
 * ```ts
 * const { app, clock } = createGame({ seed: 42 });
 * ```
 */
export function createGame(options: GameOptions = {}): Game {
  const provider = options.provider ?? memory();
  const clock = options.clock ?? fakeClock(startMoment);
  const app = createApp({
    plugins: [rewardFeature.logicOnly],
    pluginConfigs: {
      model: {
        playerProvider: provider,
        initialPlayer: options.player ?? startingPlayer,
        initialSession: startingSession,
        seed: options.seed ?? 42
      },
      clock: { source: clock },
      flow: { mainFlow, safeNode: "home" }
    }
  });

  return { app, clock, provider };
}

/**
 * The plugins of the game with its screen: the nine screen plugins, `audio`, which is opt-in, and
 * every feature — the board, the reward, the HUD, the orders and the settings.
 */
const screenPlugins = [
  ...screen,
  audioPlugin,
  rewardFeature,
  boardView,
  hudFeature,
  ordersFeature,
  settingsFeature,
  settingsLocalePlugin
];

/** The game with its screen and the two seams a test holds on to. */
export type ScreenGame = {
  app: ReturnType<typeof createApp<typeof screenPlugins>>;
  clock: Clock;
  provider: Provider;
};

/** What a test may pin when it creates the game with its screen. */
export type ScreenGameOptions = GameOptions & {
  /** The manifest the assets plugin reads. A URL in the browser, the parsed file in a test. */
  manifest?: string | Assets.Manifest;
};

/**
 * Creates the same game with its screen composed: the screen set, `audio` and the view half of
 * every feature. Without a document the renderer is inert, the audio context stays locked and the
 * assets plugin reads the manifest only, so this runs in plain Bun exactly like the headless game.
 *
 * @param options - The seams a test pins, plus the manifest.
 * @returns The app and the seams behind it.
 * @example
 * ```ts
 * const { app } = createScreenGame({ seed: 42 });
 * await app.start();
 * app.scenes.current(); // undefined: the graph rests on "home", which names no scene
 * ```
 */
export function createScreenGame(options: ScreenGameOptions = {}): ScreenGame {
  const provider = options.provider ?? memory();
  const clock = options.clock ?? fakeClock(startMoment);
  const app = createApp({
    plugins: [...screenPlugins],
    pluginConfigs: {
      model: {
        playerProvider: provider,
        initialPlayer: options.player ?? startingPlayer,
        initialSession: startingSession,
        seed: options.seed ?? 42
      },
      clock: { source: clock },
      flow: { mainFlow, safeNode: "home" },
      assets: { manifest: options.manifest },
      i18n: { locale: "ru", fallback: "ru" },
      audio: { volumes: volumesOf }
    }
  });

  return { app, clock, provider };
}
