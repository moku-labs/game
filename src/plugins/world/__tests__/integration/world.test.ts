import { describe, expect, it } from "vitest";
import { createApp, createPlugin, defineGame, exit, type } from "../../../../index";
import { timePlugin } from "../../../time";
import { component, system } from "../../ecs/define";
import { worldPlugin } from "../../index";
import { projection } from "../../projection/define";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock, flow and world plugins
// ---------------------------------------------------------------------------

type Item = { id: string; level: number; x: number };
type Player = { items: Item[] };
type Session = { moves: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const Level = component("Level", { level: 1 });
const Transform = component("Transform", { x: 0, y: 0 });
const Drifted = component("Drifted", { count: 0 });

const boardItems = projection({
  name: "board.items",
  layer: "items",
  from: (player: Player) => player.items,
  key: (item: Item) => item.id,
  view: (item: Item) => [Level({ level: item.level }), Transform({ x: item.x })],
  motion: { change: { Transform: view => view.toRest(Transform, { ms: 100, ease: "linear" }) } }
});

const drift = system({
  name: "drift",
  phase: "animate",
  query: [Level],
  run: (entities, ctx) => {
    for (const [entity] of entities) {
      if (ctx.world.has(entity, Drifted)) {
        ctx.world.set(entity, Drifted, { count: (ctx.world.get(entity, Drifted)?.count ?? 0) + 1 });
      } else {
        ctx.world.add(entity, Drifted({ count: 0 }));
      }
    }
  }
});

const home = defineNode({
  outcomes: { merge: type<{ id: string }>(), quit: type() },
  rest: true
});

const applyMerge = defineNode({
  input: type<{ id: string }>(),
  outcomes: { done: type() },
  run: ({ player, session, input, out }) => {
    const target = player.items.find(item => item.id === input.id);

    if (target !== undefined) target.level += 1;
    player.items = player.items.filter(item => item.id !== "b");
    session.moves += 1;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, applyMerge },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { merge: "applyMerge", quit: exit("over") }, applyMerge: { done: "home" } }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  components: [Level, Transform, Drifted],
  systems: [drift],
  projections: [boardItems]
});

/** Records the frame phase order the probe plugin saw, to prove registration order. */
const probeOrder: string[] = [];

const probePlugin = createPlugin("probe", {
  depends: [timePlugin, worldPlugin],
  onInit: ctx => {
    ctx.require(timePlugin).onFrame("input", () => {
      probeOrder.push(
        `probe:${ctx.require(worldPlugin).projection.entityOf("board.items", "a") === undefined ? "before" : "after"}`
      );
    });
  }
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts an app with the full V1 set plus `world`, the board feature and the probe.
 *
 * @returns The started app.
 */
async function startApp() {
  const app = createApp({
    plugins: [worldPlugin, boardFeature, probePlugin],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: {
        initialPlayer: {
          items: [
            { id: "a", level: 1, x: 0 },
            { id: "b", level: 1, x: 80 }
          ]
        },
        initialSession: { moves: 0 },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  return app;
}

describe("world plugin integration", () => {
  it("mounts a feature projection, plays a commit and converges", async () => {
    probeOrder.length = 0;

    const app = await startApp();

    app.world.projection.setLayers([{ name: "items", sort: "y" }]);
    app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });

    const entity = app.world.projection.entityOf("board.items", "a");

    expect(entity).toBeDefined();
    expect(app.world.ecs.get(entity ?? 0, Level)).toEqual({ level: 1 });

    expect(app.flow.gate.answer({ intent: "merge", payload: { id: "a" } })).toBe(true);
    await tick();

    app.time.step(16);
    expect(app.world.ecs.get(entity ?? 0, Level)).toEqual({ level: 2 });
    expect(app.world.projection.entityOf("board.items", "b")).toBeUndefined();

    for (let index = 0; index < 20; index += 1) app.time.step(16);

    expect(app.world.ecs.get(entity ?? 0, Transform)).toEqual({ x: 0, y: 0 });
    expect(app.world.ecs.get(entity ?? 0, Drifted)?.count).toBeGreaterThan(0);

    await app.stop();
  });

  it("runs a frame callback registered in an onInit before the reconcile of the same frame", async () => {
    probeOrder.length = 0;

    const app = await startApp();

    app.world.projection.setLayers([{ name: "items", sort: "y" }]);
    app.time.step(16);

    expect(probeOrder[0]).toBe("probe:before");

    app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });
    app.time.step(16);

    expect(probeOrder.at(-1)).toBe("probe:after");

    await app.stop();
  });

  it("sets the picture with no track in fast mode and leaves an empty world on stop", async () => {
    const app = await startApp();

    app.world.projection.setLayers([{ name: "items", sort: "y" }]);
    app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });
    app.world.ecs.setMode("fast");

    expect(app.flow.gate.answer({ intent: "merge", payload: { id: "a" } })).toBe(true);
    await tick();

    const entity = app.world.projection.entityOf("board.items", "a") ?? 0;

    expect(app.world.ecs.get(entity, Level)).toEqual({ level: 2 });

    const snapshot = app.world.ecs.snapshot() as { entities: unknown[] };

    expect(snapshot.entities).toHaveLength(1);

    await app.stop();

    const empty = app.world.ecs.snapshot() as { entities: unknown[]; resources: object };

    expect(empty.entities).toEqual([]);
    expect(empty.resources).toEqual({});
  });
});
