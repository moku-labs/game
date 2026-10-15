/**
 * @file The run time of a game with sub-features, on the episodes game: the shell composes the
 * flattened tree, an episode's bundle and its strings arrive together and leave together, a
 * budget episode stays, a locale switch brings the loaded episode's strings, and a restore at the
 * ward waits for the bundle the ward scene names from the session. The screen app runs over the
 * fixture's own files; every answer is given live, so the rests release as a player's would.
 */

import type { Assets } from "@moku-labs/game";
import { assetsPlugin, createPlugin } from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { createHeadless } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { tr } from "../fixtures/episodes-game/core/kit";
import episodesGame, { episodesDefinition } from "../fixtures/episodes-game/index";
import { episodesFolder, readEpisodesManifest, startEpisodes } from "./episodes-helpers";
import { folderIo, frames, until } from "./mini-helpers";

/** What the probe heard of `assets:bundle-unloaded`, per app. */
type Unloaded = Assets.Events["assets:bundle-unloaded"];

/**
 * Builds the screen app of the episodes game over its own files, with a probe plugin that keeps
 * every `assets:bundle-unloaded`. Not started.
 *
 * @returns The app and the unloads it heard.
 */
async function buildEpisodes() {
  const unloaded: Unloaded[] = [];
  const probePlugin = createPlugin("unloadProbe", {
    depends: [assetsPlugin],
    hooks: () => ({
      "assets:bundle-unloaded": (payload: Unloaded) => {
        unloaded.push(payload);
      }
    })
  });
  const game = defineGameApp({ ...episodesDefinition, plugins: [probePlugin] });
  const { app } = game.screen({
    manifest: await readEpisodesManifest(),
    io: folderIo(episodesFolder).io
  });

  return { app, unloaded };
}

/** The screen app of the episodes game with its probe. */
type Probed = Awaited<ReturnType<typeof buildEpisodes>>["app"];

/**
 * Answers the gate the graph waits at, live, and waits for the next rest: its gate open and its
 * scene laid out.
 *
 * @param app - The running game.
 * @param intent - The answer.
 * @param next - The path of the rest node the answer leads to.
 */
async function answer(app: Probed, intent: string, next: string): Promise<void> {
  expect(app.flow.gate.answer({ intent }), `${intent} at ${app.flow.state().path}`).toBe(true);
  await until(app, () => {
    const state = app.flow.state();

    return state.path === next && state.pending.gate !== undefined;
  });
  await frames(app);
}

/**
 * Starts the game and walks it live from Home through one episode to the ward.
 *
 * @param episode - The intent at the picker: `ep01` or `ep02`.
 * @returns The running game at `episodes/ward`, and the unloads it heard.
 */
async function toWard(episode: "ep01" | "ep02") {
  const { app, unloaded } = await buildEpisodes();

  await startEpisodes(app);
  await answer(app, "play", "episodes/pick");
  await answer(app, episode, "episodes/ward");

  return { app, unloaded };
}

describe("episodes-walk — the headless app", () => {
  it("the headless app registers the flattened tree, parents first, each sub-feature with its parent", async () => {
    const { app } = episodesGame.headless();
    const game = await createHeadless(app);

    expect(app.flow.features.all().map(({ name, parent }) => ({ name, parent }))).toEqual([
      { name: "home" },
      { name: "episodes" },
      { name: "episodes-kit", parent: "episodes" },
      { name: "ep01", parent: "episodes" },
      { name: "ep02", parent: "episodes" }
    ]);

    // Through ep02: the session starts at ep01, so the episode proves the child's node ran.
    const ward = await game.walk([
      { at: "home", intent: "play" },
      { at: "episodes/pick", intent: "ep02" }
    ]);

    expect(ward.path).toBe("episodes/ward");
    expect(app.model.store.snapshot().session).toEqual({ episode: "ep02" });

    await game.stop();
  });
});

describe("episodes-walk — the screen app", () => {
  it("entering an episode loads its bundle and its strings together; leaving releases both at the second rest after the ward stopped naming it", async () => {
    const { app, unloaded } = await toWard("ep01");
    const ofEp01 = (): Unloaded[] => unloaded.filter(event => event.bundle === "ep01");

    expect(app.scenes.current()).toBe("ward");
    expect(app.assets.isLoaded("ep01")).toBe(true);
    expect(app.i18n.has("ep01.title")).toBe(true);

    // The first rest after the ward: the ward scene was still mounted when pick's load stage ran.
    await answer(app, "leave", "episodes/pick");

    expect(app.assets.isLoaded("ep01")).toBe(true);
    expect(app.i18n.has("ep01.title")).toBe(true);
    expect(ofEp01()).toEqual([]);

    // The second rest: the picker scene names only "episodes".
    await answer(app, "back", "home");

    expect(app.assets.isLoaded("ep01")).toBe(false);
    expect(app.i18n.has("ep01.title")).toBe(false);
    expect(ofEp01()).toEqual([expect.objectContaining({ bundle: "ep01", reason: "leave" })]);

    await app.stop();
  });

  it("a budget episode stays loaded after the player leaves it", async () => {
    const { app, unloaded } = await toWard("ep02");

    await answer(app, "leave", "episodes/pick");
    await answer(app, "back", "home");

    expect(app.assets.isLoaded("ep02")).toBe(true);
    expect(app.i18n.has("ep02.title")).toBe(true);
    expect(unloaded.filter(event => event.bundle === "ep02")).toEqual([]);

    await app.stop();
  });

  it("a locale switch while an episode is loaded brings that episode's strings in the new locale", async () => {
    const { app } = await toWard("ep01");

    expect(app.i18n.plain(tr("ep01.title"))).toBe("The ward");

    await app.i18n.setLocale("ru");

    expect(app.i18n.plain(tr("ep01.title"))).toBe("Палата");

    await app.stop();
  });

  it("a restore at the ward waits for the bundle the scene names from state", async () => {
    const first = await toWard("ep02");
    const bookmark = first.app.flow.bookmark();

    await first.app.stop();

    expect(bookmark).toMatchObject({ path: "episodes/ward", session: { episode: "ep02" } });

    // A fresh page: started and running, no frame yet, so no scene is mounted.
    const { app } = await buildEpisodes();
    const loop: { failure?: unknown } = {};

    await app.start();
    app.flow.run().catch((error: unknown) => {
      loop.failure = error;
    });

    // A rest node: restore resolves before its stages ran; walk([]) returns once its gate is
    // open, which is after its scene is mounted.
    await app.flow.restore(bookmark);
    await app.flow.walk([]);

    expect(app.scenes.current()).toBe("ward");
    expect(app.assets.isLoaded("ep02")).toBe(true);
    expect(app.assets.isLoaded("episodes-kit")).toBe(true);
    expect(app.assets.texture("ep02.ward.room")).toBeDefined();
    expect(app.i18n.has("ep02.title")).toBe(true);
    expect(loop.failure).toBeUndefined();

    await app.stop();
  });
});
