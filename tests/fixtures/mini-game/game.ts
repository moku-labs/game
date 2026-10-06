/**
 * @file The composition root of the mini game: one `createApp` with the screen set, `audio`,
 * `effects` and the two features. Without seams the renderer is inert, the audio context stays
 * locked, the effects draw nothing and the assets plugin reads the manifest only, so the same app
 * runs in plain Bun. The caller owns `flow.run()`: a test runs it through `createHeadless` or by
 * hand, the dev page right after `start()`.
 */
import type { Assets, Audio, Renderer } from "@moku-labs/game";
import { audioPlugin, createApp, effectsPlugin, screen } from "@moku-labs/game";
import { homeFeature } from "./features/home";
import { infoFeature } from "./features/info";
import { mainFlow } from "./flows/main";
import type { Player } from "./state";
import { startingPlayer, startingSession } from "./state";

/** The plugins of the game: the screen set, `audio`, `effects` and the two features. */
export const miniPlugins = [...screen, audioPlugin, effectsPlugin, homeFeature, infoFeature];

/** What a caller may pin when it creates the game. */
export type MiniGameOptions = {
  /** The player a new save starts from. The starting player by default. */
  player?: Player;
  /** The manifest the assets plugin reads: a URL in the browser, the parsed file in a test. */
  manifest?: string | Assets.Manifest;
  /** The file seam of the assets plugin. Left out, every bundle counts as loaded at once. */
  io?: Assets.AssetsIo;
  /** The audio seams: the context, and how many started sounds the journal keeps. */
  audio?: { context?: () => Audio.AudioContextLike; journal: number };
  /** The renderer seams: where the canvas goes, how Pixi is loaded, which backend it asks for. */
  renderer?: {
    mount: string;
    loadPixi?: () => Promise<Renderer.PixiModule>;
    preference?: Renderer.Config["preference"];
  };
};

/**
 * Creates the mini game, not started.
 *
 * @param options - The seams a caller pins: the player, the manifest and the seams of the screen.
 * @returns The app.
 * @example
 * ```ts
 * const app = createMiniGame({ player: { count: 3 } });
 * const game = await createHeadless(app);
 * game.state().path; // "home"
 * ```
 */
export function createMiniGame(options: MiniGameOptions = {}) {
  return createApp({
    plugins: [...miniPlugins],
    pluginConfigs: {
      model: {
        initialPlayer: options.player ?? startingPlayer,
        initialSession: startingSession,
        seed: 42
      },
      flow: { mainFlow, safeNode: "home" },
      renderer: options.renderer ?? {},
      assets: { manifest: options.manifest, io: options.io },
      audio: options.audio ?? {}
    }
  });
}

/** The mini game as `createMiniGame` builds it. */
export type MiniGame = ReturnType<typeof createMiniGame>;
