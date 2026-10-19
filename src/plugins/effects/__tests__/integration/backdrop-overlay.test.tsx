import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, projection } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import type { AssetsIo, DecodedImage, Manifest, Texture } from "../../../assets/types";
import { i18nPlugin } from "../../../i18n";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { FakeRectangle, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import { stagePixi } from "../../../renderer/__tests__/stage-pixi";
import { Overlay } from "../../../renderer/components";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { uiPlugin } from "../../../ui";
import { defineComponent } from "../../../ui/jsx/component";
import { worldPlugin } from "../../../world";
import { effectsPlugin } from "../../index";
import { Frosted } from "../filter-fixtures";

// ---------------------------------------------------------------------------
// Integration (B1 of change 2026-10-19-glass-arc): a backdrop filter in a room that an `Overlay` sheet keeps as a
// picture. The whole app on the real Pixi stage, every frame drawn: while the picture stands the backdrop runs no
// pass (the frame costs what the same room without it costs), and in the frame the sheet is gone it is drawn again.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** The bundle of the fixture holds no file. */
const MANIFEST: Manifest = {
  version: 1,
  bundles: { fixture: { feature: "fixture", tier: "boot", mb: 0, files: [] } }
};

/**
 * The in-memory io: nothing is ever fetched for the empty bundle.
 *
 * @returns The io.
 */
function createIo(): AssetsIo {
  return {
    fetch: () => Promise.reject(new Error("nothing to fetch")),
    decode: () => Promise.resolve({ width: 1, height: 1 } as unknown as DecodedImage),
    createTexture: () =>
      new FakeTexture({
        source: { width: 1, height: 1, destroyed: false },
        frame: new FakeRectangle(0, 0, 1, 1)
      }) as unknown as Texture,
    sliceTexture: () => ({ label: "slice" }) as unknown as Texture,
    destroyTexture: () => undefined
  };
}

/** Yields the microtask queue to the flow loop. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * The ward: a room that fills the screen, and over it the glass layer of its lenses, a backdrop or a plain panel.
 *
 * @param glass - True for the backdrop on the glass layer.
 * @returns The projection.
 */
function ward(glass: boolean) {
  return projection({
    name: "fixture.ward",
    layer: "scene",
    from: () => ({ id: "ward" }),
    view: () => (
      <stack key="wardRoot" style={{ width: 1080, height: 2400, fill: 0x9f_b7_b4 }}>
        <stack
          key="wardGlass"
          style={{
            position: "absolute",
            left: 60,
            top: 300,
            width: 960,
            height: 560,
            fill: 0xff_f8_e7,
            reason: "glass"
          }}
          components={glass ? [Frosted({ spread: 1 })] : []}
        />
      </stack>
    )
  });
}

/** The sheet over the ward, opened and closed by its buttons; `bump` changes the sheet in every frame it is tapped. */
const Sheet = defineComponent("Sheet", {
  local: { open: false, count: 0 },
  view: (_props: object, local) => (
    <stack key="sheetRoot" style={{ width: 1080, height: 1920 }}>
      {local.open ? (
        <panel
          key="caseSheet"
          style={{
            position: "absolute",
            left: 0,
            top: 900,
            width: 1080,
            height: 1020,
            fill: 0x22_22_22,
            reason: "sheet"
          }}
          components={[Overlay({ dim: 0.5, fade: 50 })]}
        >
          <button
            key="bump"
            local={{ count: local.count + 1 }}
            style={{ width: 120 + local.count, height: 120 }}
          />
          <button key="close" local={{ open: false }} style={{ width: 120, height: 120 }} />
        </panel>
      ) : (
        <button key="open" local={{ open: true }} style={{ width: 120, height: 120 }} />
      )}
    </stack>
  )
});

const sheetScreen = projection({
  name: "fixture.sheet",
  layer: "ui",
  from: () => ({ id: "sheet" }),
  view: () => <Sheet />
});

/**
 * Starts the ward and its sheet on the real Pixi stage, every frame drawn, and lets it rest.
 *
 * @param glass - True for the backdrop on the glass layer.
 * @returns The app and the stage.
 */
async function start(glass: boolean) {
  installFakeDom({ width: 1080, height: 1920 });

  const stage = stagePixi();
  const home = defineNode({ rest: true, outcomes: {} });
  const main = defineFlow("main", {
    nodes: { home },
    start: "home",
    outcomes: {},
    edges: { home: {} }
  });
  const feature = defineFeature("fixture", {
    flows: [main],
    projections: [ward(glass), sheetScreen],
    ui: [Sheet],
    filters: [Frosted]
  });
  const app = createApp({
    plugins: [
      worldPlugin,
      rendererPlugin,
      inputPlugin,
      assetsPlugin,
      scenesPlugin,
      animPlugin,
      i18nPlugin,
      textPlugin,
      uiPlugin,
      effectsPlugin,
      feature
    ],
    pluginConfigs: {
      log: { mode: "test" },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { n: 0 }, initialSession: {}, seed: 1 },
      renderer: {
        mount: "#game",
        onDemand: false,
        loadPixi: () => Promise.resolve(stage.module),
        warm: 0
      },
      assets: { manifest: MANIFEST, io: createIo() }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([
    { name: "scene", sort: "none" },
    { name: "ui", sort: "order" }
  ]);
  app.world.projection.mount(["fixture.ward", "fixture.sheet"], { kind: "plugin", name: "test" });

  const started = { app, stage };

  await frames(started, 10);

  return started;
}

/** The started fixture. */
type Started = Awaited<ReturnType<typeof start>>;

/** What a frame steps: the app's time. */
type Stepped = { readonly app: { readonly time: { step(deltaMs: number): void } } };

/**
 * Runs frames of 16 ms.
 *
 * @param started - The app.
 * @param count - How many.
 */
async function frames(started: Stepped, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    started.app.time.step(16);
    await tick(8);
  }
}

/**
 * Taps a keyed button; its write lands in the next frame.
 *
 * @param started - The app.
 * @param key - The button.
 */
function press(started: Started, key: string): void {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = started.app.ui.find(key);

  if (entity === undefined) throw new Error(`no ${key}`);

  started.app.input.tap(entity);
}

/**
 * One drawn frame that changes the sheet, measured: the render passes of the frame and the renders into a texture
 * it made (a picture taken again would run the backdrop inside it).
 *
 * @param started - The app.
 * @returns The passes and the renders into a texture.
 */
async function bumpFrame(started: Started): Promise<{ passes: number; takes: number }> {
  const before = started.stage.targets().length;

  press(started, "bump");
  await frames(started, 1);

  return {
    passes: started.app.renderer.stats().renderPasses,
    takes: started.stage.targets().length - before
  };
}

/**
 * Opens the sheet and runs the frames until it has landed and its picture stands.
 *
 * @param started - The app.
 */
async function openSheet(started: Started): Promise<void> {
  press(started, "open");
  await frames(started, 30);

  expect(started.app.renderer.sync.debug.overlays()).toMatchObject([
    { phase: "shown", mode: "freeze", kept: true }
  ]);
}

describe("a backdrop under an overlay's kept picture", () => {
  // Bug: a backdrop inside the range an overlay keeps as a picture still runs its copy, its chain and its composite in
  // every drawn frame while the sheet stands (A Memory Missing's Wave A counted +5 passes drawing nothing).
  it("runs no pass while the picture stands: a drawn frame costs what the room without it costs", async () => {
    const glassy = await start(true);
    const plain = await start(false);

    // With no overlay the backdrop is drawn live: its passes are on top of the plain room's.
    expect(glassy.app.renderer.stats().renderPasses).toBeGreaterThan(
      plain.app.renderer.stats().renderPasses
    );

    await openSheet(glassy);
    await openSheet(plain);

    for (let frame = 0; frame < 4; frame += 1) {
      const withGlass = await bumpFrame(glassy);
      const without = await bumpFrame(plain);

      expect(withGlass).toEqual(without);
      expect(withGlass.takes).toBe(0);
    }

    await glassy.app.stop();
    await plain.app.stop();
  });

  // Bug: the backdrop stays out of the frame after the sheet left, or comes back a frame late over a stale picture.
  it("draws the backdrop again in the frame the sheet is gone", async () => {
    const glassy = await start(true);
    const live = glassy.app.renderer.stats().renderPasses;

    await openSheet(glassy);
    press(glassy, "close");

    for (let frame = 0; frame < 60; frame += 1) {
      await frames(glassy, 1);

      if (glassy.app.renderer.sync.debug.overlays().length === 0) break;

      expect(glassy.app.renderer.stats().renderPasses).toBeLessThan(live);
    }

    expect(glassy.app.renderer.sync.debug.overlays()).toEqual([]);
    expect(glassy.app.renderer.stats().renderPasses).toBe(live);

    await glassy.app.stop();
  });
});
