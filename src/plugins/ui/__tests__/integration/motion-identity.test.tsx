/**
 * @file ui plugin — a render that builds an element's `motion` anew, with the same look, leaves a
 * running tween alone (F168, A Memory Missing's claim beams). The view builds `motion` inline, so
 * every render brings new `enter` and `exit` closures. The comparison took the new identity for a
 * change and wrote the element's rest look, alpha 0, over its running enter tween: one frame drawn
 * at 0, a blink of the dim. The element still takes the new hooks: its exit plays the last ones. A
 * small game on the fake page, every frame read after it is stepped.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  defineComponent,
  defineGame,
  defineScene,
  projection,
  Shape,
  screen,
  type
} from "../../../../index";
import type { Manifest } from "../../../assets/types";
import type { CompiledMessages } from "../../../i18n/types";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { createFakePixi, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import type { ViewHandle } from "../../../world/projection/types";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: { "beam.title": Record<string, never> };
}>();

/** The one scene bundle, with no files to fetch. */
const manifest: Manifest = {
  version: 2,
  bundles: { beams: { feature: "beam", tier: "lazy", mb: 0, files: [] } }
};

/** The one compiled locale. */
const english: CompiledMessages = { "beam.title": () => [{ kind: "text", text: "beam" }] };

/** How long the dim takes to fade in and out. */
const FADE_MS = 320;

/** The render whose `exit` hook ran, one entry per exit. */
const exits: number[] = [];

/** The dim's style: alpha 0 at rest, the enter tween fades it in and holds it. */
const dimStyle = { width: 400, height: 400, fill: 0x10_20_30, alpha: 0 };

/** A button's style. */
const buttonStyle = { width: 100, height: 100 };

/** The window: a button that shows the dim, one that hides it, one that renders again, and the dim. */
const Beams = defineComponent("Beams", {
  local: { shown: false, renders: 0 },
  view: (_props: object, local) => (
    <column key="beamsRoot" style={{ width: 1080, height: 1920 }}>
      <button key="show" local={{ shown: true }} style={buttonStyle} />
      <button key="hide" local={{ shown: false }} style={buttonStyle} />
      <button key="again" local={{ renders: local.renders + 1 }} style={buttonStyle} />
      {local.shown ? (
        <stack
          key="dim"
          // Built in the view, as the game builds it: new closures at every render.
          motion={{
            enter: (view: ViewHandle<unknown>) =>
              view.tween(Shape, { alpha: 1 }, { ms: FADE_MS, ease: "linear", reduced: "keep" }),
            exit: (view: ViewHandle<unknown>) => {
              exits.push(local.renders);

              return view.tween(Shape, { alpha: 0 }, { ms: FADE_MS, reduced: "keep" });
            }
          }}
          style={dimStyle}
        />
      ) : undefined}
    </column>
  )
});

/** The window's root, a JSX root in layer `scene`. */
const beamsRoot = projection({
  name: "beam.window",
  layer: "scene",
  from: () => ({ id: "beams" }),
  view: () => <Beams />
});

const beamsScene = defineScene("beams", {
  bundle: "beams",
  layers: { scene: {} },
  projections: [beamsRoot]
});
const rest = defineNode({ rest: true, scene: "beams", outcomes: { again: type() } });
const main = defineFlow("main", {
  nodes: { rest },
  start: "rest",
  outcomes: {},
  edges: { rest: { again: "rest" } }
});
const feature = defineFeature("beam", {
  flows: [main],
  scenes: [beamsScene],
  projections: [beamsRoot],
  ui: [Beams],
  strings: { en: english }
});

const running: Array<{ stop(): Promise<void> }> = [];

/**
 * Starts the game on the window.
 *
 * @returns The running app, the frame driver and a reader of the dim's alpha.
 */
async function startBeams() {
  installFakeDom({ width: 1080, height: 1920 });
  exits.length = 0;

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

  /**
   * The alpha the dim is drawn at, read from its `Shape`.
   *
   * @returns Its alpha, or NaN while it is not there.
   */
  const dimAlpha = (): number => {
    const dim = app.ui.find("dim");

    return dim === undefined ? Number.NaN : (app.world.ecs.get(dim, Shape)?.alpha ?? Number.NaN);
  };

  await frames(8);

  return { app, frames, dimAlpha };
}

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a render that builds the motion anew (F168)", () => {
  // Bug (A Memory Missing, claim beams): the new closures counted as a change, the rest look,
  // alpha 0, was written over the running enter tween, and the dim blinked for one frame.
  it("leaves the running enter tween alone: the next frame draws the tween's alpha", async () => {
    const game = await startBeams();
    const { app } = game;

    app.input.tap(app.ui.find("show") ?? 0);
    await game.frames(8);

    const before = game.dimAlpha();

    // Mid tween: on its way from the rest 0 to 1.
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(1);

    app.input.tap(app.ui.find("again") ?? 0);
    await game.frames(1);

    // One frame on: the tween's value, a little higher, never the rest's 0.
    expect(game.dimAlpha()).toBeGreaterThan(before);
  });

  // Bug a fix could bring: the element keeps the hooks of its first render and plays a stale exit.
  it("takes the new hooks: the exit plays the motion of the last render", async () => {
    const game = await startBeams();
    const { app } = game;

    app.input.tap(app.ui.find("show") ?? 0);
    await game.frames(30);
    app.input.tap(app.ui.find("again") ?? 0);
    await game.frames(2);
    app.input.tap(app.ui.find("hide") ?? 0);
    await game.frames(2);

    expect(exits).toEqual([1]);
  });
});
