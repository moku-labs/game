/**
 * @file ui plugin — a root that leaves with its scene under its own exit keeps its picture (F55b, A Memory
 * Missing's memory room). The memory's window fades out as one kept picture; the overlay on its left side
 * has a 900 ms exit of its own. Played under the window's fade, that exit changed the window's subtree in
 * every frame: the picture churned, the window was drawn live through its filter for the whole close (168
 * passes over the close in place of 101 on the game's drawn page), and the room cleared while it closed.
 * Under a top that leads its leave, the elements stand and go with it.
 */
import { Texture } from "pixi.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  Alpha,
  createApp,
  defineComponent,
  defineGame,
  defineScene,
  effectsPlugin,
  projection,
  Sprite,
  screen,
  type
} from "../../../../index";
import type { Manifest } from "../../../assets/types";
import type { CompiledMessages } from "../../../i18n/types";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { stagePixi } from "../../../renderer/__tests__/stage-pixi";
import type { ElementMotion } from "../../jsx/types";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: { "kept.title": Record<string, never> };
}>();

/** The two scene bundles, with no files to fetch. */
const manifest: Manifest = {
  version: 2,
  bundles: {
    memory: { feature: "kept", tier: "lazy", mb: 0, files: [] },
    ward: { feature: "kept", tier: "lazy", mb: 0, files: [] }
  }
};

/** The one compiled locale. */
const english: CompiledMessages = { "kept.title": () => [{ kind: "text", text: "kept" }] };

/** The window's fade: its `Alpha` to 0 in 480 ms. */
const windowFade: ElementMotion = {
  exit: view => view.tween(Alpha, { alpha: 0 }, { ms: 480, reduced: "keep" })
};

/** The overlay's own exit, as the game wrote it before its interim check: its sprite to 0 in 900 ms. */
const leftFade: ElementMotion = {
  exit: view => view.tween(Sprite, { alpha: 0 }, { ms: 900, reduced: "keep" })
};

/** The memory's window: the room, the overlay with a long exit, and the door to the ward. */
const Memory = defineComponent("Memory", {
  view: () => (
    <stack
      key="window"
      motion={windowFade}
      components={[Alpha()]}
      style={{ width: 1080, height: 1920 }}
    >
      <image key="room" texture="room" style={{ width: 1080, height: 1920 }} />
      <image key="left" texture="left" motion={leftFade} style={{ width: 400, height: 1920 }} />
      <button key="door" intent="ward" style={{ width: 200, height: 200 }} />
    </stack>
  )
});

/** The memory's root, a JSX root in layer `scene`. */
const memoryRoot = projection({
  name: "kept.memory",
  layer: "scene",
  from: () => ({ id: "memory" }),
  view: () => <Memory />
});

/** The ward's root, in the same layer: the memory closes over it. */
const wardRoot = projection({
  name: "kept.ward",
  layer: "scene",
  from: () => ({ id: "ward" }),
  view: () => <stack key="wardRoot" style={{ width: 1080, height: 1920 }} />
});

const memoryScene = defineScene("memory", {
  bundle: "memory",
  layers: { scene: {} },
  projections: [memoryRoot]
});
const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { scene: {} },
  projections: [wardRoot]
});
const memory = defineNode({ rest: true, scene: "memory", outcomes: { ward: type() } });
const ward = defineNode({ rest: true, scene: "ward", outcomes: { back: type() } });
const main = defineFlow("main", {
  nodes: { memory, ward },
  start: "memory",
  outcomes: {},
  edges: { memory: { ward: "ward" }, ward: { back: "memory" } }
});
const feature = defineFeature("kept", {
  flows: [main],
  scenes: [memoryScene, wardScene],
  projections: [memoryRoot, wardRoot],
  ui: [Memory],
  strings: { en: english }
});

const running: Array<{ stop(): Promise<void> }> = [];

/**
 * Starts the game on the memory, its window standing.
 *
 * @returns The running app and the frame driver.
 */
async function startMemory() {
  installFakeDom({ width: 1080, height: 1920 });

  const stage = stagePixi();
  const app = createApp({
    plugins: [...screen, effectsPlugin, feature],
    pluginConfigs: {
      assets: { manifest },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      renderer: {
        mount: "#game",
        loadPixi: () => Promise.resolve(stage.module),
        warm: 0
      }
    }
  });

  await app.start();
  running.push(app);
  app.renderer.sync.textures.provide(() => Texture.WHITE as never);
  app.flow.run().catch(() => undefined);

  /**
   * Steps frames of 16 ms, the runner given its turn before each.
   *
   * @param count - How many.
   */
  const frames = async (count: number): Promise<void> => {
    for (let frame = 1; frame <= count; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      app.time.step(16);
    }
  };

  await frames(20);

  return { app, frames };
}

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
});

describe("a window that closes with its scene under its own fade (F55b)", () => {
  // Bug (A Memory Missing, memory → ward): the overlay faded with the close, the room cleared and the
  // window was drawn through its filter in every frame of its fade.
  it("stands its overlay and fades as one kept picture", async () => {
    const { app, frames } = await startMemory();
    const left = app.ui.find("left") ?? 0;

    app.input.tap(app.ui.find("door") ?? 0);

    const alphas: number[] = [];
    const passes: number[] = [];

    // 24 frames: 384 ms of the window's 480 ms fade.
    for (let frame = 0; frame < 24; frame += 1) {
      await frames(1);
      alphas.push(app.world.ecs.get(left, Sprite)?.alpha ?? 1);
      passes.push(app.renderer.sync.renderPasses());
    }

    expect(app.flow.state().path).toBe("ward");
    expect(Math.min(...alphas)).toBe(1);
    // Past the first frames of the switch, the window is its picture at the fade's alpha: one pass.
    expect(passes.slice(8)).toEqual(passes.slice(8).map(() => 1));
  });
});
