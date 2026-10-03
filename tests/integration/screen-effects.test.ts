/**
 * @file Root integration — the fixture game drawn, with `effectsPlugin` (V5 wave A). The game runs
 * with a mount on the fake page and the fake Pixi of the engine's own tests, its assets read from
 * the fixture folder as loose files, one texture source each, and the dev flag on, as on the dev
 * page. Then the numbers of `app.effects.stats()` say what the effects plugin really draws: the
 * honey glow of Play, the steam over the sawmill, the bursts of a merge that end once their
 * particles died, and nothing left after `stop()`. The headless half reads the components on the
 * entities (`merge-game/__tests__/effects.test.ts`).
 */
import { readFile } from "node:fs/promises";
import type { Assets, Model } from "@moku-labs/game";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakeEffectsPixi,
  FakeFxParticleContainer
} from "../../src/plugins/effects/__tests__/fake-effects-pixi";
import { installFakeDom } from "../../src/plugins/renderer/__tests__/fake-dom";
import { FakeRectangle, FakeTexture } from "../../src/plugins/renderer/__tests__/fake-pixi";
import { createScreenGame } from "./merge-game/game";
import type { Player } from "./merge-game/state";
import { player, tick, withItems } from "./timber-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The folder of the fixture game: the manifest and every asset path are relative to it. */
const gameFolder = new URL("merge-game/", import.meta.url);

/** Two twigs side by side: a drag merges them into a log. */
const twoTwigs = withItems([
  { id: "i1", chain: "wood", level: 1, cell: "c1_0" },
  { id: "i2", chain: "wood", level: 1, cell: "c2_0" }
]);

/** The game drawn on the fake Pixi. */
type DrawnGame = ReturnType<typeof createScreenGame>;

/** One entity of `world.ecs.snapshot()`, as far as these tests read it. */
type WorldEntity = {
  owner: { kind: string; name: string };
  components: Record<string, Model.Json>;
};

/**
 * The file seam over the fixture folder: every file is read from disk, every image decodes to the
 * size the manifest gives it, and every texture is its own source, as loose files are.
 *
 * @param manifest - The committed manifest.
 * @returns The io.
 */
function diskIo(manifest: Assets.Manifest): Assets.AssetsIo {
  const sizes = new Map<string, { width: number; height: number }>();
  const decoded = new WeakMap<Blob, { width: number; height: number }>();

  for (const bundle of Object.values(manifest.bundles)) {
    for (const file of bundle.files) {
      if (file.path !== undefined && file.width !== undefined && file.height !== undefined) {
        sizes.set(file.path, { width: file.width, height: file.height });
      }
    }
  }

  return {
    fetch: async url => {
      const path = url.replace(/^\//, "");
      const bytes = await readFile(new URL(path, gameFolder));
      const blob = new Blob([bytes]);

      // A font page is not in the manifest: the fonts are one 512 × 512 page each.
      decoded.set(blob, sizes.get(path) ?? { width: 512, height: 512 });

      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(bytes.toString("utf8")) as unknown),
        blob: () => Promise.resolve(blob),
        text: () => Promise.resolve(bytes.toString("utf8")),
        arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer)
      };
    },
    decode: blob =>
      Promise.resolve(
        decoded.get(blob) ?? { width: 512, height: 512 }
      ) as Promise<Assets.DecodedImage>,
    createTexture: image => {
      const { width, height } = image as unknown as { width: number; height: number };

      return new FakeTexture({
        source: { width, height, destroyed: false },
        frame: new FakeRectangle(0, 0, width, height)
      }) as unknown as Assets.Texture;
    },
    sliceTexture: () => ({ label: "slice" }) as unknown as Assets.Texture,
    destroyTexture: () => undefined
  };
}

/**
 * Runs frames of 16 ms, each followed by its microtasks and one task: the assets are read from
 * disk, which settles in a later task.
 *
 * @param game - The running game.
 * @param count - How many frames.
 */
async function frames(game: DrawnGame, count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    game.app.time.step(16);
    await tick();
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  }
}

/**
 * Runs frames until a condition holds. Fails the test when it never holds.
 *
 * @param game - The running game.
 * @param done - The condition.
 * @param limit - How many frames at most.
 */
async function until(game: DrawnGame, done: () => boolean, limit = 200): Promise<void> {
  for (let frame = 0; frame < limit && !done(); frame += 1) await frames(game, 1);

  expect(done()).toBe(true);
}

/**
 * Starts the game drawn, with the dev flag of the dev page, and waits for Home.
 *
 * @param start - The player a new save starts from.
 * @returns The game, resting on `home`.
 */
async function startDrawn(start: Player): Promise<DrawnGame> {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  installFakeDom({ width: 1080, height: 1920 });

  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", gameFolder), "utf8")
  ) as Assets.Manifest;
  // The shared fake draws the labels of `text` and compiles the WGSL of `Glow` with no error.
  const pixi = createFakeEffectsPixi();
  const game = createScreenGame({
    player: start,
    manifest,
    io: diskIo(manifest),
    renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module) }
  });

  await game.app.start();
  game.app.flow.run().catch(() => undefined);
  await until(game, () => game.app.flow.state().path === "home" && game.app.renderer.host.ready());
  await frames(game, 4);

  return game;
}

/**
 * Taps Play and waits for the board.
 *
 * @param game - The game, resting on `home`.
 */
async function openBoard(game: DrawnGame): Promise<void> {
  expect(game.app.input.tap(game.app.ui.find("play") ?? 0)).toBe(true);
  await until(game, () => game.app.flow.state().path === "board/awaitIntent");
  await frames(game, 4);
}

/**
 * The entities the effects plugin owns: one per particle container.
 *
 * @param game - The running game.
 * @returns Their snapshots.
 */
function containersOf(game: DrawnGame): WorldEntity[] {
  const snapshot = game.app.world.ecs.snapshot() as unknown as { entities: WorldEntity[] };

  return snapshot.entities.filter(
    entity => entity.owner.kind === "plugin" && entity.owner.name === "effects"
  );
}

/**
 * What went wrong while the game was drawn: errors and warnings of the effects plugin and of the
 * renderer's sync.
 *
 * @param game - The running game.
 * @returns The events.
 */
function problemsOf(game: DrawnGame): string[] {
  return game.app.log
    .trace()
    .filter(entry => entry.event.startsWith("effects:") || entry.event.startsWith("renderer:"))
    .filter(entry => entry.level === "warn" || entry.level === "error")
    .map(entry => entry.event);
}

describe("screen-effects — the fixture drawn with effectsPlugin", () => {
  it("draws the honey glow of Play on Home: one filter, three render passes", async () => {
    const game = await startDrawn(player);

    expect(game.app.effects.stats()).toEqual({
      particles: 0,
      emitters: 0,
      filters: 1,
      renderPasses: 3
    });
    expect(problemsOf(game)).toEqual([]);

    await game.app.stop();
  });

  it("smokes over the sawmill on the board, above the board screen, and glows on the ready Deliver", async () => {
    const game = await startDrawn(player);

    await openBoard(game);

    const stats = game.app.effects.stats();

    // One stream, warmed up for two seconds, so the chimney smokes from the first frame.
    expect(stats.emitters).toBe(1);
    expect(stats.particles).toBeGreaterThan(0);
    // The Deliver of the one ready order glows; the other two are grey.
    expect(stats.filters).toBe(1);
    expect(containersOf(game).map(entity => entity.components)).toEqual([
      expect.objectContaining({ Layer: { name: "ui" }, Order: { value: 0.5 } })
    ]);
    expect(problemsOf(game)).toEqual([]);

    await game.app.stop();
  });

  it("adds the two bursts of a merge and ends them once their particles died", async () => {
    const game = await startDrawn(twoTwigs);

    await openBoard(game);

    const steam = game.app.effects.stats();

    expect(
      game.app.input.drag(
        { projection: "board.items", key: "i1" },
        { projection: "board.items", key: "i2" }
      )
    ).toBe(true);
    await frames(game, 2);

    const burst = game.app.effects.stats();

    // The steam, the stars and the sparkles: 14 stars and 18 sparkles in the air.
    expect(burst.emitters).toBe(steam.emitters + 2);
    expect(burst.particles).toBeGreaterThanOrEqual(steam.particles + 14 + 18 - 2);

    await until(game, () => game.app.effects.stats().emitters === steam.emitters, 120);

    // The timeline despawned the hosts; the orphans flew until their last particle died.
    expect(containersOf(game)).toHaveLength(1);
    expect(FakeFxParticleContainer.made.filter(container => container.destroyed)).toHaveLength(2);
    expect(problemsOf(game)).toEqual([]);

    await game.app.stop();
  });

  it("frees every particle container and filter when the game stops", async () => {
    const game = await startDrawn(player);

    await openBoard(game);
    await game.app.stop();

    expect(game.app.effects.stats()).toEqual({
      particles: 0,
      emitters: 0,
      filters: 0,
      renderPasses: 0
    });
    expect(FakeFxParticleContainer.made.length).toBeGreaterThan(0);
    expect(FakeFxParticleContainer.made.every(container => container.destroyed)).toBe(true);
  });
});
