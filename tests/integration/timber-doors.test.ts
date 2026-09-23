/**
 * @file The editor doors on Timber Town, headless: an e2e script loads a prepared save through
 * `/control`, taps its way to a delivered order, and reads through `/inspect` where the game rests,
 * where a button sits and what the player heard. The game runs with its screen, the fixture's own
 * files behind the assets seam and a fake audio context, unlocked by a first pointer event.
 */
import { readFile } from "node:fs/promises";
import type { Assets } from "@moku-labs/game";
import { commands, run } from "@moku-labs/game/control";
import { read, sources } from "@moku-labs/game/inspect";
import type { Repro } from "@moku-labs/game/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakeContext,
  installFakeWindow
} from "../../src/plugins/audio/__tests__/fake-audio-context";
import { createScreenGame, startMoment } from "./merge-game/game";
import type { Player } from "./merge-game/state";
import { startingSession } from "./merge-game/state";
import { scenarios } from "./merge-game/web/scenarios";
import type { Game } from "./timber-helpers";
import { frames, tick, until } from "./timber-helpers";

/** What a production build throws for every `/control` command. */
const refused = "[game] Control commands run in dev builds only.";

/**
 * The file seam of `assets` over the disk: every file of the fixture is really read, so the
 * sounds have bytes to decode. The images decode to a stand-in and the textures are stand-ins,
 * because the renderer is inert.
 */
const diskIo: Assets.AssetsIo = {
  fetch: async url => {
    const bytes = await readFile(new URL(`merge-game/${url.replace(/^\//u, "")}`, import.meta.url));

    return new Response(bytes);
  },
  decode: async () => ({ width: 1, height: 1 }) as unknown as ImageBitmap,
  createTexture: () =>
    ({ label: "stand-in" }) as unknown as ReturnType<Assets.AssetsIo["createTexture"]>,
  destroyTexture: () => undefined
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
 * The `ready` save of the dev page: a Plank ready for the first order. Its energy is counted
 * from the start moment of the fake clock, as the page counts it from the moment it opens.
 *
 * @returns The prepared player.
 */
function readySave(): Player {
  const save = scenarios.ready;

  if (save === undefined) throw new Error("the fixture has no ready save");

  return {
    ...save,
    merge: { ...save.merge, energy: { ...save.merge.energy, countedAt: startMoment } }
  };
}

/** The bug report an e2e script loads: the `ready` save, entered at Home, with no route. */
const repro = {
  player: readySave(),
  session: startingSession,
  checkpoint: "home",
  route: []
} satisfies Repro;

/**
 * Starts the game the dev page runs, on Home: a new save, the fixture's files, a fake audio
 * context and the journal of 200 sounds. A first pointer event unlocks the context, since the
 * sounds are dropped until then.
 *
 * @returns The game, resting on `home` with the Home screen laid out and its audio unlocked.
 */
async function startDevGame(): Promise<Game> {
  const page = installFakeWindow();
  const context = createFakeContext();
  const game = createScreenGame({
    manifest: await readManifest(),
    io: diskIo,
    audio: { context: () => context, journal: 200 }
  });
  const loop: { failure?: unknown } = {};

  await game.app.start();
  game.app.flow.run().catch((error: unknown) => {
    loop.failure = error;
  });
  await until(game, () => loop.failure !== undefined || game.app.flow.state().path === "home");

  if (loop.failure !== undefined) throw loop.failure;

  await frames(game);
  page.dispatch("pointerdown");
  await tick();
  expect(game.app.audio.unlocked()).toBe(true);

  return game;
}

/**
 * The keys of every sound the game started, oldest first, read through `/inspect`.
 *
 * @param game - The running game.
 * @returns The keys of the audio journal.
 */
function heard(game: Game): string[] {
  return read(game.app, sources.sounds).map(sound => sound.key);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("timber-doors — an e2e script on the dev build", () => {
  it("restores the ready save, taps Play and Deliver, and hears the click and the order", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const game = await startDevGame();
    const app = game.app;

    const restored = await run(app, commands.restore, { repro });

    expect(restored.value.path).toBe("home");
    expect(restored.state).toMatchObject({ path: "home", tainted: true });
    await frames(game);

    const played = await run(app, commands.tap, { key: "play" });

    expect(played.value).toBe(true);
    await until(game, () => read(app, sources.position).path === "board/awaitIntent");
    await frames(game);

    expect(read(app, sources.position)).toMatchObject({ flow: "board", node: "awaitIntent" });

    const deliver = read(app, sources.rect, { key: "deliver0" });

    expect(deliver).toBeDefined();
    expect(deliver?.w).toBeGreaterThan(0);
    expect(deliver?.h).toBeGreaterThan(0);

    const delivered = await run(app, commands.tap, { key: "deliver0" });

    expect(delivered.value).toBe(true);
    await until(game, () => heard(game).includes("orders.complete"));

    expect(heard(game)).toEqual(expect.arrayContaining(["ui.click", "orders.complete"]));
    expect(read(app, sources.sounds)).toContainEqual(
      expect.objectContaining({ key: "orders.complete", bus: "sfx", kind: "sfx" })
    );

    await app.stop();
  });

  it("keeps the session clean for a route command and taints it with a raw one", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const game = await startDevGame();
    const app = game.app;

    const played = await run(app, commands.tap, { key: "play" });

    expect(played.state.tainted).toBe(false);
    await until(game, () => read(app, sources.position).path === "board/awaitIntent");
    expect([read(app, sources.tainted), read(app, sources.cheats)]).toEqual([false, []]);

    const restored = await run(app, commands.restore, { repro });

    expect(restored.state).toMatchObject({ path: "home", tainted: true });
    expect(read(app, sources.tainted)).toBe(true);
    expect(read(app, sources.cheats)).toEqual([
      { id: "game.restore", input: { repro }, frame: restored.state.frame }
    ]);

    await app.stop();
  });
});

describe("timber-doors — the same page without the dev flag", () => {
  it("refuses every command and leaves the game and the session untouched", async () => {
    const game = await startDevGame();
    const app = game.app;

    await expect(run(app, commands.tap, { key: "play" })).rejects.toThrow(refused);
    await expect(run(app, commands.restore, { repro })).rejects.toThrow(refused);
    await frames(game);

    expect(read(app, sources.position).path).toBe("home");
    expect([read(app, sources.tainted), read(app, sources.cheats)]).toEqual([false, []]);
    expect(heard(game)).not.toContain("ui.click");

    await app.stop();
  });
});
