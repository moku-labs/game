import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, exit, type } from "../../../../index";
import { worldPlugin } from "../../../world";
import { component, Layer, system } from "../../../world/ecs/define";
import { Sprite, sprite, Transform } from "../../components";
import { rendererPlugin } from "../../index";
import { installFakeDom } from "../fake-dom";
import { createFakePixi, FakeTexture } from "../fake-pixi";

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock, flow, world and renderer
// ---------------------------------------------------------------------------

type Player = { items: Array<{ id: string; level: number; x: number }> };
type Session = { moves: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const Level = component("Level", { level: 1 });

const home = defineNode({ outcomes: { quit: type() }, rest: true });
const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { quit: exit("over") } }
});

const paint = system({
  name: "paint",
  phase: "layout",
  query: [Level],
  run: () => undefined
});

const boardFeature = defineFeature("board", {
  flows: [main],
  components: [Level],
  systems: [paint]
});

const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

async function startApp(mount: string | undefined) {
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, boardFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: {
        initialPlayer: { items: [{ id: "a", level: 1, x: 0 }] },
        initialSession: { moves: 0 },
        seed: 1
      },
      renderer: mount === undefined ? {} : { mount }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  return app;
}

describe("renderer plugin integration", () => {
  it("is inert without a DOM and answers nothing about pixels", async () => {
    const app = await startApp(undefined);

    expect(app.renderer.host.ready()).toBe(false);
    expect(app.renderer.host.kind()).toBe("none");
    expect(app.renderer.host.canvas()).toBeUndefined();
    expect(app.renderer.sync.hitTest(10, 10, () => true)).toBeUndefined();
    expect(app.renderer.viewport.toReference(120, 340)).toEqual({ x: 120, y: 340 });
    expect(app.renderer.viewport.size().scale).toBe(1);

    app.world.projection.setLayers([{ name: "items", sort: "y" }]);
    app.world.ecs.spawn({ kind: "plugin", name: "test" }, [
      Layer({ name: "items" }),
      ...sprite({ texture: "board.cell", at: { x: 540, y: 300 } })
    ]);
    app.time.step(16);

    expect(app.renderer.sync.displayOf(1)).toBeUndefined();

    await app.stop();
  });

  it("draws the world into the layers of the scene, and leaves nothing behind", async () => {
    const dom = installFakeDom({ width: 1080, height: 1920 });
    const pixi = createFakePixi();

    const app = createApp({
      plugins: [worldPlugin, rendererPlugin, boardFeature],
      pluginConfigs: {
        flow: { mainFlow: main },
        model: {
          initialPlayer: { items: [{ id: "a", level: 1, x: 0 }] },
          initialSession: { moves: 0 },
          seed: 1
        },
        renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module) }
      }
    });

    await app.start();
    app.flow.run().catch(() => undefined);
    await tick();

    expect(app.renderer.host.ready()).toBe(true);
    expect(app.renderer.host.kind()).toBe("webgpu");
    expect(app.renderer.host.canvas()).toBe(pixi.last().canvas);

    // A 1080x1920 mount is inside the aspect range, so the whole canvas is the frame.
    expect(app.renderer.viewport.size()).toMatchObject({
      width: 1080,
      height: 1920,
      scale: 1,
      orientation: "portrait"
    });
    expect(app.renderer.viewport.toReference(540, 960)).toEqual({ x: 540, y: 960 });

    const off = app.renderer.sync.textures.provide(() => new FakeTexture({}) as never);

    app.world.projection.setLayers([
      { name: "board", sort: "none" },
      { name: "items", sort: "y" }
    ]);

    const entity = app.world.ecs.spawn({ kind: "plugin", name: "test" }, [
      Layer({ name: "items" }),
      ...sprite({ texture: "board.cell", at: { x: 540, y: 300 } })
    ]);

    app.time.step(16);

    const object = app.renderer.sync.displayOf(entity);

    expect(object).toBeDefined();
    expect(object).toHaveProperty("label", `Sprite#${entity}`);
    expect(object).toHaveProperty("zIndex", 300);
    expect(app.renderer.sync.hitTest(540, 300, () => true)).toBe(entity);
    expect(pixi.last().renderer.renders).toBeGreaterThan(0);

    // The pointer moves and the picture follows, in the same frame.
    app.world.ecs.set(entity, Transform, { x: 100, y: 800 });
    app.time.step(16);
    expect(app.renderer.sync.hitTest(100, 800, () => true)).toBe(entity);

    // A texture key that lost its provider falls back to the magenta placeholder.
    off();
    app.renderer.sync.textures.invalidate(["board.cell"]);
    app.time.step(16);
    expect(app.renderer.sync.displayOf(entity)).toHaveProperty("tint", 0xff_00_ff);

    const alive = app.world.ecs.get(entity, Sprite);

    expect(alive?.texture).toBe("board.cell");

    await app.stop();

    expect(pixi.last().destroyed).toBe(true);
    expect(dom.mount.children).toHaveLength(0);
    expect(dom.documentListeners()).toBe(0);
    expect(dom.observers[0]?.disconnected).toBe(true);
  });
});
