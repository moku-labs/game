/**
 * @file ui plugin — what a reconcile changes is drawn in its own frame (F46, F47, A Memory Missing's dialogue and
 * inspect plates). A keyed element that leaves with no exit is not drawn in the frame that swaps it for another, and
 * a box whose layout changes takes its new pivot and its new position in the same frame. A small game on the fake
 * page, every frame read after it is stepped.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  defineComponent,
  defineGame,
  defineMotion,
  defineScene,
  projection,
  screen,
  Transform,
  type
} from "../../../../index";
import type { Manifest } from "../../../assets/types";
import type { CompiledMessages } from "../../../i18n/types";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { createFakePixi, FakeTexture } from "../../../renderer/__tests__/fake-pixi";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: { "frame.title": Record<string, never> };
}>();

/** The one scene bundle, with no files to fetch. */
const manifest: Manifest = {
  version: 2,
  bundles: { plate: { feature: "frame", tier: "lazy", mb: 0, files: [] } }
};

/** The one compiled locale. */
const english: CompiledMessages = { "frame.title": () => [{ kind: "text", text: "frame" }] };

/** A slow bob of the inspect box: 10 units down and back over 2 s, an offset over its rest. */
const bob = defineMotion({
  keyframes: {
    bob: [
      { at: 0, Transform: { dy: 0 } },
      { at: 0.5, Transform: { dy: 10 } },
      { at: 1, Transform: { dy: 0 } }
    ]
  },
  transition: { ms: 250 },
  loop: { track: "bob", ms: 2000 },
  on: {}
});

/** Whether the inspect box bobs, set by a test. */
const looks = { bob: false };

/**
 * The plate: the speaker's face, keyed by who speaks, with no exit; a centred box whose height follows the lines;
 * and the two buttons that swap the speaker and add a line.
 */
const Plate = defineComponent("Plate", {
  local: { speaker: "anya", tall: false },
  view: (_props: object, local) => (
    <column key="plateRoot" style={{ width: 1080, height: 1920 }}>
      <stack key={`face-${local.speaker}`} style={{ width: 200, height: 200, fill: 0x88_44_22 }} />
      <stack
        key="inspect"
        {...(looks.bob ? { motion: bob } : {})}
        style={{ width: 400, height: local.tall ? 200 : 100, origin: "center", fill: 0x22_44_88 }}
      />
      <button key="swap" local={{ speaker: "lev" }} style={{ width: 100, height: 100 }} />
      <button key="grow" local={{ tall: true }} style={{ width: 100, height: 100 }} />
    </column>
  )
});

/** The plate's root, a JSX root in layer `scene`. */
const plateRoot = projection({
  name: "frame.plate",
  layer: "scene",
  from: () => ({ id: "plate" }),
  view: () => <Plate />
});

const plateScene = defineScene("plate", {
  bundle: "plate",
  layers: { scene: {} },
  projections: [plateRoot]
});
const rest = defineNode({ rest: true, scene: "plate", outcomes: { again: type() } });
const main = defineFlow("main", {
  nodes: { rest },
  start: "rest",
  outcomes: {},
  edges: { rest: { again: "rest" } }
});
const feature = defineFeature("frame", {
  flows: [main],
  scenes: [plateScene],
  projections: [plateRoot],
  ui: [Plate],
  strings: { en: english }
});

const running: Array<{ stop(): Promise<void> }> = [];

/**
 * Starts the game on the plate.
 *
 * @returns The running app, the frame driver and whether an entity is drawn.
 */
async function startPlate() {
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakePixi();
  const app = createApp({
    plugins: [...screen, feature],
    pluginConfigs: {
      assets: { manifest },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module), warm: 0 }
    }
  });

  await app.start();
  running.push(app);
  app.renderer.sync.textures.provide(() => new FakeTexture({}) as never);
  app.flow.run().catch(() => undefined);

  /**
   * Steps frames of 16 ms, the runner given its turn before each, and reads each.
   *
   * @param count - How many.
   * @param each - What runs after each frame.
   */
  const frames = async (count: number, each?: () => void): Promise<void> => {
    for (let frame = 1; frame <= count; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      app.time.step(16);
      each?.();
    }
  };

  await frames(8);

  return {
    app,
    frames,
    drawn: (entity: number): boolean => app.renderer.sync.displayOf(entity) !== undefined
  };
}

/**
 * The top edge of an element's drawn box: where its pivot lands, less the pivot at its scale.
 *
 * @param app - The running app.
 * @param entity - The element's entity.
 * @returns The top edge, `NaN` while it has no `Transform`.
 */
function topEdgeOf(app: Awaited<ReturnType<typeof startPlate>>["app"], entity: number): number {
  const pose = app.world.ecs.get(entity, Transform);

  return pose === undefined ? Number.NaN : pose.y - pose.pivot.y * pose.scale;
}

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  looks.bob = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a keyed swap with no exit (F46)", () => {
  // Bug (A Memory Missing, speaker swap): the old face was drawn once more in the frame that brought the new one,
  // so both faces showed for a frame.
  it("never draws the old element in a frame that draws the new one", async () => {
    const game = await startPlate();
    const { app } = game;
    const old = app.ui.find("face-anya") ?? 0;
    const both: number[] = [];
    let frame = 0;

    expect(game.drawn(old)).toBe(true);

    app.input.tap(app.ui.find("swap") ?? 0);
    await game.frames(6, () => {
      frame += 1;

      const next = app.ui.find("face-lev");

      if (next !== undefined && game.drawn(next) && game.drawn(old)) both.push(frame);
    });

    expect(app.ui.find("face-lev")).toBeDefined();
    expect(both).toEqual([]);
  });
});

describe("a box whose layout changes (F47)", () => {
  // Bug (A Memory Missing, inspect plate): the new pivot was written at once and the position a frame later, so the
  // centred box jumped by the pivot difference for one frame.
  it("keeps its top edge in every frame when it grows downwards around its centre", async () => {
    const game = await startPlate();
    const { app } = game;
    const box = app.ui.find("inspect") ?? 0;
    const top = (): number => topEdgeOf(app, box);
    const before = top();
    const tops: number[] = [];

    app.input.tap(app.ui.find("grow") ?? 0);
    await game.frames(6, () => tops.push(top()));

    expect(app.world.ecs.get(box, Transform)?.pivot.y).toBe(100);
    expect(tops).toEqual(tops.map(() => before));
  });

  // The other side: a box whose loop adds to its rest keeps that offset through the new rest: no frame drops it.
  it("keeps a bobbing box moving by its bob alone when it grows", async () => {
    looks.bob = true;

    const game = await startPlate();
    const { app } = game;
    const box = app.ui.find("inspect") ?? 0;
    const top = (): number => topEdgeOf(app, box);
    const tops = [top()];

    app.input.tap(app.ui.find("grow") ?? 0);
    await game.frames(6, () => tops.push(top()));

    const steps = tops.slice(1).map((value, index) => Math.abs(value - (tops[index] ?? value)));

    expect(app.world.ecs.get(box, Transform)?.pivot.y).toBe(100);
    expect(Math.max(...steps)).toBeGreaterThan(0);
    expect(Math.max(...steps)).toBeLessThan(1);
  });
});
