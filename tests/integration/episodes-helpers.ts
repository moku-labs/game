/**
 * @file What the tests on the episodes game share: its folder, its committed dev manifest, the
 * type of its screen app and the start that waits for Home. The fixture is a game with a parent
 * feature `episodes` and three sub-features. Nothing here imports a test runner, as in
 * `mini-helpers.ts`, whose file seam and waits these tests reuse.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Assets } from "@moku-labs/game";
import type episodesGame from "../fixtures/episodes-game/index";
import { frames, until } from "./mini-helpers";

/** The episodes game as `episodesGame.screen()` builds it: the screen app, not started. */
export type EpisodesGame = ReturnType<typeof episodesGame.screen>["app"];

/** The folder of the episodes game, ending in `/`: the manifest's paths are relative to it. */
export const episodesFolder = new URL("../fixtures/episodes-game/", import.meta.url);

/** The folder of the episodes game, as an absolute path. */
export const EPISODES_GAME = fileURLToPath(episodesFolder);

/**
 * Reads the committed dev manifest `generated/manifest.json` of the episodes game.
 *
 * @returns The parsed manifest.
 */
export async function readEpisodesManifest(): Promise<Assets.Manifest> {
  return JSON.parse(
    await readFile(new URL("generated/manifest.json", episodesFolder), "utf8")
  ) as Assets.Manifest;
}

/**
 * Starts the game live, runs its graph and waits for Home. A failure of the graph reaches the
 * caller instead of a handler.
 *
 * @param app - The game, not started: the screen app, or one built with a probe plugin.
 * @returns The same game, resting on `home` with its scene mounted.
 */
export async function startEpisodes<App extends Pick<EpisodesGame, "start" | "flow" | "time">>(
  app: App
): Promise<App> {
  const loop: { failure?: unknown } = {};

  await app.start();
  app.flow.run().catch((error: unknown) => {
    loop.failure = error;
  });
  await until(app, () => {
    const state = app.flow.state();

    return (
      loop.failure !== undefined || (state.path === "home" && state.pending.gate !== undefined)
    );
  });

  if (loop.failure !== undefined) throw loop.failure;

  await frames(app);

  return app;
}
