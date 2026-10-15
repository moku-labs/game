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
import { defineFilter, defineGame, exit, Shape, Transform, type } from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import type * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakeEffectsPixi,
  FakeFxParticleContainer
} from "../../src/plugins/effects/__tests__/fake-effects-pixi";
import { installFakeDom } from "../../src/plugins/renderer/__tests__/fake-dom";
import { FakeRectangle, FakeTexture } from "../../src/plugins/renderer/__tests__/fake-pixi";
import miniGame from "../fixtures/mini-game/index";
import { openPage, watch } from "./drawn-helpers";
import type { MiniGame } from "./mini-helpers";
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
  // The shared fake draws the labels of `text` and compiles the WGSL of `Glow` with no error. It cannot build the
  // probes of the warm-up (spec 27): the warm-up is off, as the counts below are the game's own.
  const pixi = createFakeEffectsPixi();
  const renderer = { mount: "#game", loadPixi: () => Promise.resolve(pixi.module), warm: 0 };
  const { app } = miniGame.screen({ manifest, io: diskIo(manifest), renderer });

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

/** The bundle of the lens's screen holds no file. */
const LENS_MANIFEST: Assets.Manifest = {
  version: 2,
  bundles: { memory: { feature: "memory", tier: "core", mb: 0, files: [] } }
};

const lensKit = defineGame<{
  player: { n: number };
  session: { n: number };
  assets: string;
  scenes: "memory";
  strings: Record<string, never>;
}>();

/**
 * A Memory Missing's lens (spec 27 P1.7): outside its disc it draws nothing, so Pixi renders and fills only the box
 * around it.
 */
const LensWindow = defineFilter("LensWindow", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv) * fu.inner; }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord) * inner; }",
  uniforms: { cx: 195, cy: 189, rev: 84, inner: 4, soft: 4 },
  area: value => {
    const reach = value.rev + value.soft;

    return [value.cx - reach, value.cy - reach, 2 * reach, 2 * reach];
  }
});

/** The full-screen cover the lens looks through. */
const cover = lensKit.projection({
  name: "memory.cover",
  layer: "main",
  from: () => ({}),
  view: () => [
    Transform({ x: 0, y: 0 }),
    Shape({ kind: "rect", w: 390, h: 844, fill: 0x20_20_28 }),
    LensWindow()
  ]
});

const memoryNode = lensKit.defineNode({
  scene: "memory",
  outcomes: { done: type() },
  rest: true,
  checkpoint: true
});

const memoryFlow = lensKit.defineFlow("main", {
  nodes: { memory: memoryNode },
  start: "memory",
  outcomes: { over: type() },
  edges: { memory: { done: exit("over") } }
});

const memoryFeature = lensKit.defineFeature("memory", {
  scenes: [
    lensKit.defineScene("memory", {
      bundle: "memory",
      layers: { main: { sort: "order" } },
      projections: [cover]
    })
  ],
  projections: [cover],
  filters: [LensWindow]
});

describe("a lens with an area (spec 27 B4)", () => {
  // Bug: the lens of the memory screen fills the whole cover: 1.67–2.5 MPx a frame for a 0.24 MPx disc.
  it("a lens with an area keeps its picture inside the area and draws nothing outside", async () => {
    const page = openPage(390, 844);
    const { app } = defineGameApp({
      flow: memoryFlow,
      safeNode: "memory",
      player: { n: 0 },
      session: { n: 0 },
      referenceSide: 390,
      features: [memoryFeature],
      pluginConfigs: {
        log: { mode: "test" },
        flow: { holdMs: 0 },
        // Every frame drawn: a still filtered view is taken as a picture after two drawn frames (spec 23).
        renderer: { ...page.renderer, onDemand: false }
      }
    }).screen({ manifest: LENS_MANIFEST });

    await app.start();
    app.flow.run().catch(() => undefined);

    const watched = watch(app, page);

    await watched.frames(12);

    const entity = app.world.projection.entityOf("memory.cover", "memory.cover");
    const top = app.renderer.sync.displayOf(entity ?? 0) as pixi.Container | undefined;
    const area = top?.filterArea;

    // rev 84, soft 4: the 176 × 176 box around (195, 189), in the cover's own units (a shape at scale 1).
    expect(
      area === undefined || area === null ? undefined : [area.x, area.y, area.width, area.height]
    ).toEqual([107, 101, 176, 176]);
    // The still cover is drawn from its kept picture, taken with the lens; the picture is what the top draws now.
    expect(app.renderer.stats().kept.pictures).toBe(1);
    watched.oracle.expectNoMissedFrame();
    watched.oracle.expectPicturesCurrent();

    await app.stop();
  });
});
