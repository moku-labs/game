import { describe, expect, it } from "vitest";
import { createApp, createPlugin, defineGame, exit, Transform, type } from "../../../../index";
import { rendererPlugin } from "../../../renderer";
import { timePlugin } from "../../../time";
import { worldPlugin } from "../../../world";
import { projection } from "../../../world/projection/define";
import { animPlugin } from "../../index";
import { defineAnimation, mark, play, sequence, tween } from "../../timeline/steps";
import type { Target } from "../../types";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock, flow, world, renderer and anim
// plugins, in plain Bun. Frames are driven by `app.time.step`.
// ---------------------------------------------------------------------------

type Item = { id: string; x: number };
type Player = { items: Item[] };
type Session = { moves: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const card: Target = { projection: "board.items", key: "a" };

const deliverOrder = defineAnimation("orders.deliver", {
  slots: { card: type<Target>() },
  build: ({ card: target }) =>
    sequence(tween(target, Transform, { x: 100 }, { ms: 100, ease: "linear" }), mark("done"))
});

const boardItems = projection({
  name: "board.items",
  layer: "items",
  from: (player: Player) => player.items,
  key: (item: Item) => item.id,
  view: (item: Item) => [Transform({ x: item.x, y: 0, rotation: 0, scale: 1 })]
});

const home = defineNode({ outcomes: { go: type(), quit: type() }, rest: true });

const deliver = defineNode({
  outcomes: { done: type() },
  run: async ({ fx, out }) => {
    await fx(play(deliverOrder, { card }));

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, deliver },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { go: "deliver", quit: exit("over") }, deliver: { done: "home" } }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  projections: [boardItems],
  animations: [deliverOrder]
});

/** What the probe saw in the animate phase, after the anim step of the same frame. */
const probeSaw: Array<number | undefined> = [];

const probePlugin = createPlugin("probe", {
  depends: [timePlugin, worldPlugin],
  onInit: ctx => {
    const world = ctx.require(worldPlugin);

    ctx.require(timePlugin).onFrame("animate", () => {
      const entity = world.projection.entityOf("board.items", "a");

      probeSaw.push(entity === undefined ? undefined : world.ecs.get(entity, Transform)?.x);
    });
  }
});

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts an app with `world`, `renderer`, `anim`, the board feature and the order probe.
 *
 * @returns The started app.
 */
async function startApp() {
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, boardFeature, probePlugin],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: {
        initialPlayer: { items: [{ id: "a", x: 0 }] },
        initialSession: { moves: 0 },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "items", sort: "none" }]);
  app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });

  return app;
}

describe("anim plugin integration", () => {
  it("plays a choreography through app.anim and resolves done when it ends", async () => {
    const app = await startApp();
    const entity = app.world.projection.entityOf("board.items", "a") ?? 0;
    const handle = app.anim.play(deliverOrder, { card });

    app.time.step(50);

    expect(app.world.ecs.get(entity, Transform)?.x).toBe(50);
    expect(app.anim.active()).toBe(1);

    app.time.step(50);
    await handle.done;

    expect(app.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(handle.marks()).toEqual(["done"]);
    expect(app.anim.active()).toBe(0);

    await app.stop();
  });

  it("resolves a node that awaits fx(play(...)) when the timeline ends", async () => {
    const app = await startApp();
    const entity = app.world.projection.entityOf("board.items", "a") ?? 0;

    expect(app.flow.gate.answer({ intent: "go" })).toBe(true);
    await tick();
    app.time.step(16);

    expect(app.anim.active()).toBe(1);

    for (let index = 0; index < 10; index += 1) {
      app.time.step(16);
      await tick(4);
    }

    expect(app.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(app.anim.active()).toBe(0);
    expect(app.flow.gate.answer({ intent: "go" })).toBe(true);

    await app.stop();
  });

  it("runs the animate step of anim before the world callback of the same phase", async () => {
    const app = await startApp();

    probeSaw.length = 0;
    app.anim.play(deliverOrder, { card });
    app.time.step(50);

    expect(probeSaw.at(-1)).toBe(50);

    await app.stop();
  });

  it("freezes a timeline while the world is paused", async () => {
    const app = await startApp();
    const entity = app.world.projection.entityOf("board.items", "a") ?? 0;
    const handle = app.anim.play(deliverOrder, { card });

    app.world.ecs.setMode("paused");
    app.time.step(50);
    app.time.step(50);

    expect(app.world.ecs.get(entity, Transform)?.x).toBe(0);
    expect(handle.active()).toBe(true);

    await app.stop();
  });

  it("finishes every timeline on the first frame of fast mode", async () => {
    const app = await startApp();
    const entity = app.world.projection.entityOf("board.items", "a") ?? 0;
    const handle = app.anim.play(deliverOrder, { card });

    app.world.ecs.setMode("fast");
    app.time.step(16);
    await handle.done;

    expect(app.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(handle.marks()).toEqual(["done"]);
    expect(app.anim.active()).toBe(0);

    await app.stop();
  });

  it("stops with an empty table and resolves what was still running", async () => {
    const app = await startApp();
    const handle = app.anim.play(deliverOrder, { card });

    await app.stop();
    await handle.done;

    expect(app.anim.active()).toBe(0);
  });
});
