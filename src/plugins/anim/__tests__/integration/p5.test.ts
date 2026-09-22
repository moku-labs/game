import { describe, expect, it } from "vitest";
import { createApp, defineGame, Exiting, exit, Transform, type } from "../../../../index";
import { rendererPlugin } from "../../../renderer";
import { worldPlugin } from "../../../world";
import { component } from "../../../world/ecs/define";
import { projection } from "../../../world/projection/define";
import type { ProjectionMotion } from "../../../world/types";
import { animPlugin } from "../../index";

// ---------------------------------------------------------------------------
// The eight spike P5 cases, replayed with the REAL tween driver of `anim`: the real time,
// lifecycle, model, clock, flow, world and anim plugins, in plain Bun.
// ---------------------------------------------------------------------------

type Item = { id: string; level: number; x: number; y: number };
type Player = { items: Item[] };
type Session = { moves: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const Level = component("Level", { level: 1 });

const home = defineNode({
  outcomes: { move: type<{ items: Item[] }>(), quit: type() },
  rest: true
});

const apply = defineNode({
  input: type<{ items: Item[] }>(),
  outcomes: { done: type() },
  run: ({ player, session, input, out }) => {
    player.items = input.items.map(item => ({ ...item }));
    session.moves += 1;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, apply },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { move: "apply", quit: exit("over") }, apply: { done: "home" } }
});

const LAYERS = [
  { name: "items", sort: "y" },
  { name: "lifted", sort: "none" }
] as const;

const START: Item[] = [
  { id: "a", level: 1, x: 0, y: 0 },
  { id: "b", level: 1, x: 80, y: 0 }
];

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts an app with `world`, `renderer`, `anim` and one board projection carrying the motion
 * hooks of the case under test.
 *
 * @param motion - The motion hooks of this case.
 * @param items - The items the player starts with.
 * @returns The started app.
 */
async function startBoard(motion: ProjectionMotion<Item>, items: Item[] = START) {
  const boardItems = projection({
    name: "board.items",
    layer: "items",
    lift: "lifted",
    from: (player: Player) => player.items,
    key: (item: Item) => item.id,
    view: (item: Item) => [
      Level({ level: item.level }),
      Transform({ x: item.x, y: item.y, rotation: 0, scale: 1 })
    ],
    motion
  });
  const boardFeature = defineFeature("board", { flows: [main], projections: [boardItems] });
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, boardFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { items }, initialSession: { moves: 0 }, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([...LAYERS]);
  app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });
  // One frame drains the dirty record the boot of the graph left, so the next commit reconciles
  // with the cause `edge` alone and the motion hooks really play.
  app.time.step(16);

  return app;
}

type BoardApp = Awaited<ReturnType<typeof startBoard>>;

/**
 * Commits a new item list through the graph.
 *
 * @param app - The started app.
 * @param items - The new item list.
 */
async function move(app: BoardApp, items: Item[]): Promise<void> {
  expect(app.flow.gate.answer({ intent: "move", payload: { items } })).toBe(true);
  await tick();
}

/**
 * Runs frames until no track is active, with an upper bound so a bug cannot hang the suite.
 *
 * @param app - The started app.
 * @param max - Largest number of frames to run.
 */
function settleFrames(app: BoardApp, max = 300): void {
  for (let index = 0; index < max; index += 1) {
    app.time.step(16);

    if (app.anim.active() === 0) return;
  }
}

/**
 * The convergence assertion every case ends with: nothing moves any more and the picture equals
 * the rest pose of the item, field for field.
 *
 * @param app - The started app.
 * @param key - The model key of the view.
 * @param item - The item the rest pose is read from.
 */
function expectAtRest(app: BoardApp, key: string, item: Item): void {
  const entity = app.world.projection.entityOf("board.items", key) ?? 0;

  expect(app.anim.active()).toBe(0);
  expect(app.world.ecs.get(entity, Transform)).toEqual({
    x: item.x,
    y: item.y,
    rotation: 0,
    scale: 1
  });
  expect(app.world.ecs.get(entity, Level)).toEqual({ level: item.level });
}

describe("anim — the eight P5 cases with the real driver", () => {
  it("retarget: a second move cancels the running track and starts from the current values", async () => {
    const starts: number[] = [];
    const app = await startBoard({
      change: {
        Transform: view => {
          starts.push(view.get(Transform)?.x ?? -1);

          return view.toRest(Transform, { ms: 350, ease: "linear" });
        }
      }
    });
    const entity = app.world.projection.entityOf("board.items", "a") ?? 0;

    await move(app, [
      { id: "a", level: 1, x: 100, y: 0 },
      { id: "b", level: 1, x: 80, y: 0 }
    ]);
    app.time.step(16);
    app.time.step(100);

    const midway = app.world.ecs.get(entity, Transform)?.x ?? -1;

    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(100);

    await move(app, [
      { id: "a", level: 1, x: 200, y: 0 },
      { id: "b", level: 1, x: 80, y: 0 }
    ]);
    app.time.step(16);

    expect(starts[1]).toBe(midway);

    settleFrames(app);
    expectAtRest(app, "a", { id: "a", level: 1, x: 200, y: 0 });

    await app.stop();
  });

  it("settle: a drop with no commit sends the view home", async () => {
    const settled: string[][] = [];
    const app = await startBoard({
      settle: (view, components) => {
        settled.push([...components]);

        return view.toRest(Transform, { ms: 200, ease: "linear" });
      }
    });
    const entity = app.world.projection.entityOf("board.items", "a") ?? 0;

    app.world.ecs.set(entity, Transform, { x: 77, y: 33 });
    app.world.projection.settle(entity);

    expect(settled).toEqual([["Transform"]]);
    expect(app.anim.active()).toBe(1);

    settleFrames(app);
    expectAtRest(app, "a", { id: "a", level: 1, x: 0, y: 0 });

    await app.stop();
  });

  it("revive: a view that comes back before the queue drained keeps its entity", async () => {
    const app = await startBoard({
      exit: view => view.tween(Transform, { x: 400 }, { ms: 400, ease: "linear" }),
      enter: view => view.toRest(Transform, { ms: 100, ease: "linear" })
    });
    const entity = app.world.projection.entityOf("board.items", "b") ?? 0;

    await move(app, [{ id: "a", level: 1, x: 0, y: 0 }]);
    app.time.step(16);

    expect(app.world.projection.entityOf("board.items", "b")).toBeUndefined();

    await move(app, START);
    app.time.step(16);

    expect(app.world.projection.entityOf("board.items", "b")).toBe(entity);

    settleFrames(app);
    expectAtRest(app, "b", { id: "b", level: 1, x: 80, y: 0 });

    await app.stop();
  });

  it("exit target gone: peer answers from the old state and the view still leaves", async () => {
    const targets: Array<number | undefined> = [];
    const app = await startBoard({
      exit: (view, _item, hint) => {
        const into = (hint?.payload as { into?: string } | undefined)?.into ?? "";
        const peer = view.peer(into);

        targets.push(peer?.x);

        return view.tween(Transform, { x: peer?.x ?? 0 }, { ms: 100, ease: "linear" });
      }
    });

    await move(app, [{ id: "a", level: 1, x: 0, y: 0 }]);
    app.time.step(16);

    expect(targets).toEqual([undefined]);

    settleFrames(app);

    expect(app.world.projection.entityOf("board.items", "b")).toBeUndefined();
    expect(app.anim.active()).toBe(0);

    await app.stop();
  });

  it("two commits in one frame: the picture converges on the last one", async () => {
    const app = await startBoard({
      change: { Transform: view => view.toRest(Transform, { ms: 200, ease: "linear" }) }
    });

    await move(app, [
      { id: "a", level: 1, x: 100, y: 0 },
      { id: "b", level: 1, x: 80, y: 0 }
    ]);
    await move(app, [
      { id: "a", level: 2, x: 140, y: 0 },
      { id: "b", level: 1, x: 80, y: 0 }
    ]);
    settleFrames(app);
    expectAtRest(app, "a", { id: "a", level: 2, x: 140, y: 0 });

    await app.stop();
  });

  it("lost hint: an entry without a hint plays the default motion and still converges", async () => {
    const hints: Array<string | undefined> = [];
    const app = await startBoard({
      change: {
        Transform: (view, _previous, _next, hint) => {
          hints.push(hint?.kind);

          return view.toRest(Transform, { ms: 100, ease: "linear" });
        }
      }
    });

    await move(app, [
      { id: "a", level: 1, x: 120, y: 0 },
      { id: "b", level: 1, x: 80, y: 0 }
    ]);
    settleFrames(app);

    expect(hints).toEqual([undefined]);
    expectAtRest(app, "a", { id: "a", level: 1, x: 120, y: 0 });

    await app.stop();
  });

  it("unmount flush: every track ends and the views are gone", async () => {
    const app = await startBoard({
      change: { Transform: view => view.toRest(Transform, { ms: 400, ease: "linear" }) }
    });

    await move(app, [
      { id: "a", level: 1, x: 300, y: 0 },
      { id: "b", level: 1, x: 80, y: 0 }
    ]);
    app.time.step(16);

    expect(app.anim.active()).toBeGreaterThan(0);

    app.world.projection.unmount(["board.items"]);

    expect(app.anim.active()).toBe(0);
    expect(app.world.projection.entityOf("board.items", "a")).toBeUndefined();

    await app.stop();
  });

  it("not hit-tested while queued: an exiting view carries Exiting until its motion ends", async () => {
    const app = await startBoard({
      exit: view => view.tween(Transform, { x: 400 }, { ms: 200, ease: "linear" })
    });
    const entity = app.world.projection.entityOf("board.items", "b") ?? 0;

    await move(app, [{ id: "a", level: 1, x: 0, y: 0 }]);
    app.time.step(16);

    expect(app.world.ecs.has(entity, Exiting)).toBe(true);
    expect(app.world.projection.entityOf("board.items", "b")).toBeUndefined();

    settleFrames(app);

    expect(app.world.ecs.has(entity, Exiting)).toBe(false);
    expect(app.anim.active()).toBe(0);

    await app.stop();
  });
});
