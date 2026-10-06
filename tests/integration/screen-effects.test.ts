/**
 * @file Root integration — the mini game drawn, with `effectsPlugin`. The game runs with a mount on
 * the fake page and the fake Pixi of the engine's own tests, its assets read from the fixture
 * folder as loose files, one texture source each, and the dev flag on, as on the dev page. Then
 * the numbers of `app.effects.stats()` say what the effects plugin really draws: the honey glow of
 * the info button, the spark burst the popup opens with, which ends once its particles died, and
 * nothing left after `stop()`.
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
import type { MiniGame } from "../fixtures/mini-game/game";
import { createMiniGame } from "../fixtures/mini-game/game";
import { frames, miniFolder, readManifest, until } from "./mini-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
      const bytes = await readFile(new URL(path, miniFolder));
      const blob = new Blob([bytes]);

      // A font page is not in the manifest: the font is one 512 × 512 page.
      decoded.set(blob, sizes.get(path) ?? { width: 512, height: 512 });

      return {
        ok: true,
        status: 200,
        // eslint-disable-next-line unicorn/no-null -- a `Response` answers a missing header with null.
        headers: { get: () => null },
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
 * Starts the game drawn, with the dev flag of the dev page, and waits for Home.
 *
 * @returns The game, resting on `home`.
 */
async function startDrawn(): Promise<MiniGame> {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  installFakeDom({ width: 1080, height: 1920 });

  const manifest = await readManifest();
  // The shared fake draws the labels of `text` and compiles the WGSL of `Glow` with no error.
  const pixi = createFakeEffectsPixi();
  const app = createMiniGame({
    manifest,
    io: diskIo(manifest),
    renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module) }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await until(app, () => app.flow.state().path === "home" && app.renderer.host.ready());
  await frames(app, 4);

  return app;
}

/**
 * Taps the info button and waits for the popup.
 *
 * @param app - The game, resting on `home`.
 */
async function openInfo(app: MiniGame): Promise<void> {
  expect(app.input.tap(app.ui.find("info") ?? 0)).toBe(true);
  await until(app, () => app.flow.state().path === "info/show");
}

/**
 * The entities the effects plugin owns: one per particle container.
 *
 * @param app - The running game.
 * @returns Their snapshots.
 */
function containersOf(app: MiniGame): WorldEntity[] {
  const snapshot = app.world.ecs.snapshot() as unknown as { entities: WorldEntity[] };

  return snapshot.entities.filter(
    entity => entity.owner.kind === "plugin" && entity.owner.name === "effects"
  );
}

/**
 * What went wrong while the game was drawn: errors and warnings of the effects plugin and of the
 * renderer's sync.
 *
 * @param app - The running game.
 * @returns The events.
 */
function problemsOf(app: MiniGame): string[] {
  return app.log
    .trace()
    .filter(entry => entry.event.startsWith("effects:") || entry.event.startsWith("renderer:"))
    .filter(entry => entry.level === "warn" || entry.level === "error")
    .map(entry => entry.event);
}

describe("screen-effects — the mini game drawn with effectsPlugin", () => {
  it("draws the honey glow of the info button on Home: one filter, three render passes", async () => {
    const app = await startDrawn();

    expect(app.effects.stats()).toEqual({
      particles: 0,
      emitters: 0,
      filters: 1,
      renderPasses: 3
    });
    expect(problemsOf(app)).toEqual([]);

    await app.stop();
  });

  it("bursts the sparks as the popup opens, above the screen, and ends them once they died", async () => {
    const app = await startDrawn();

    await openInfo(app);
    await frames(app, 2);

    const burst = app.effects.stats();

    // One burst of twelve sparks in the air, a frame or two of them already gone.
    expect(burst.emitters).toBe(1);
    expect(burst.particles).toBeGreaterThanOrEqual(12 - 2);
    expect(containersOf(app).map(entity => entity.components)).toEqual([
      expect.objectContaining({ Layer: { name: "ui" }, Order: { value: 1000 } })
    ]);

    await until(app, () => app.effects.stats().emitters === 0, 120);

    // The timeline despawned the host; the orphans flew until their last particle died.
    expect(app.effects.stats().particles).toBe(0);
    expect(containersOf(app)).toEqual([]);
    expect(FakeFxParticleContainer.made.filter(container => container.destroyed)).toHaveLength(1);
    expect(problemsOf(app)).toEqual([]);

    await app.stop();
  });

  it("frees every particle container and filter when the game stops", async () => {
    const app = await startDrawn();

    await openInfo(app);
    await frames(app, 2);
    await app.stop();

    expect(app.effects.stats()).toEqual({
      particles: 0,
      emitters: 0,
      filters: 0,
      renderPasses: 0
    });
    expect(FakeFxParticleContainer.made.length).toBeGreaterThan(0);
    expect(FakeFxParticleContainer.made.every(container => container.destroyed)).toBe(true);
  });
});
