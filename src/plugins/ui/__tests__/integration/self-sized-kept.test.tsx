/**
 * @file ui plugin — a blurred image whose sprite a game's own system sizes stays a kept picture (F111, A Memory
 * Missing's case sheet). Its style states no size, so the layout leaves it 0 by 0; a system writes the size into its
 * `Sprite`. 0.15.54 put such an image at alpha 0: the backdrop vanished and its blur was never kept.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Blur, createApp, defineGame, projection, Sprite } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import type { AssetsIo, DecodedImage, Manifest, Texture } from "../../../assets/types";
import { effectsPlugin } from "../../../effects";
import { i18nPlugin } from "../../../i18n";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { FakeRectangle, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import { stagePixi } from "../../../renderer/__tests__/stage-pixi";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { worldPlugin } from "../../../world";
import { Box } from "../../components";
import { uiPlugin } from "../../index";

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

/** The sheet: a blurred backdrop placed by its left and top alone, its size left to a system. */
const sheet = projection({
  name: "fixture.sheet",
  layer: "scene",
  from: () => ({ id: "sheet" }),
  view: () => (
    <stack key="sheetRoot" style={{ width: 1080, height: 1920 }}>
      <image
        key="caseBack"
        texture="room"
        fit="fill"
        style={{ position: "absolute", left: 0, top: 0, reason: "a system sizes it" }}
        components={[Blur({ strength: 4 })]}
      />
    </stack>
  )
});

/**
 * Starts the sheet on the real Pixi stage, every frame drawn.
 *
 * @returns The app and the stage.
 */
async function start() {
  installFakeDom({ width: 1080, height: 1920 });

  const stage = stagePixi();
  const home = defineNode({ rest: true, outcomes: {} });
  const main = defineFlow("main", {
    nodes: { home },
    start: "home",
    outcomes: {},
    edges: { home: {} }
  });
  const feature = defineFeature("fixture", { flows: [main], projections: [sheet] });
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
  app.world.projection.setLayers([{ name: "scene", sort: "none" }]);
  app.world.projection.mount(["fixture.sheet"], { kind: "plugin", name: "test" });

  return { app, stage };
}

/** The started fixture. */
type Started = Awaited<ReturnType<typeof start>>;

/**
 * Runs frames of 16 ms.
 *
 * @param started - The app.
 * @param count - How many.
 */
async function frames(started: Started, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    started.app.time.step(16);
    await tick(8);
  }
}

describe("a blurred image sized by a game's system (F111)", () => {
  // Bug: the image, laid out 0 by 0 because its style states no size, is put at alpha 0; the backdrop draws nothing
  // and its blurred picture is never taken.
  it("keeps its alpha, is blurred once into a kept picture, and takes no picture again at rest", async () => {
    const started = await start();
    const { app, stage } = started;

    await frames(started, 2);

    const back = app.ui.find("caseBack");

    if (back === undefined) throw new Error("no caseBack");
    expect(app.world.ecs.get(back, Box)).toMatchObject({ w: 0, h: 0 });

    // The game's system: the backdrop covers the screen.
    app.world.ecs.set(back, Sprite, { width: 1080, height: 1920 });
    await frames(started, 10);

    expect(app.world.ecs.get(back, Sprite)).toMatchObject({
      alpha: 1,
      width: 1080,
      height: 1920
    });
    expect(stage.targets().some(call => call.container.label.includes("caseBack"))).toBe(true);

    const taken = stage.targets().length;

    await frames(started, 10);

    expect(stage.targets().length).toBe(taken);
  });
});
