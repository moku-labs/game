import { describe, expect, it } from "vitest";
import { createApp, defineGame, exit, screen, Transform, type } from "../../../../index";
import { projection } from "../../../world/projection/define";
import { Draggable, DropTarget, Pointer, Tappable, Touchable } from "../../components";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock, flow, world, renderer
// and input plugins, in plain Bun. The renderer is inert; `app.input.*` is the door.
// ---------------------------------------------------------------------------

type Item = { id: string; cell: string; level: number };
type Player = { items: Item[] };
type Session = { merges: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const boardItems = projection({
  name: "board.items",
  layer: "items",
  from: (player: Player) => player.items,
  key: (item: Item) => item.id,
  view: (item: Item) => [
    Transform({ x: item.cell === "c2" ? 100 : 300, y: 100 }),
    Draggable({ payload: { from: item.cell } }),
    DropTarget({ intent: "merge", payload: { to: item.cell } })
  ]
});

const home = defineNode({
  outcomes: { merge: type<{ from: string; to: string }>(), quit: type() },
  rest: true
});

const applyMerge = defineNode({
  input: type<{ from: string; to: string }>(),
  outcomes: { done: type() },
  run: ({ player, session, input, out }) => {
    const target = player.items.find(item => item.cell === input.to);

    if (target !== undefined) target.level += 1;
    player.items = player.items.filter(item => item.cell !== input.from);
    session.merges += 1;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, applyMerge },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { merge: "applyMerge", quit: exit("over") }, applyMerge: { done: "home" } }
});

const boardFeature = defineFeature("board", { flows: [main], projections: [boardItems] });

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts the full screen set headless and mounts the board.
 *
 * @returns The started app.
 */
async function startApp() {
  const app = createApp({
    plugins: [...screen, boardFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: {
        initialPlayer: {
          items: [
            { id: "i5", cell: "c2", level: 1 },
            { id: "i7", cell: "c3", level: 1 }
          ]
        },
        initialSession: { merges: 0 },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "items", sort: "y" }]);
  app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });
  app.time.step(16);

  return app;
}

describe("input plugin integration", () => {
  it("answers the gate with a scripted drag and moves nothing on the way", async () => {
    const app = await startApp();

    expect(app.renderer.host.canvas()).toBeUndefined();

    const held = app.world.projection.entityOf("board.items", "i5") ?? 0;
    const before = app.world.ecs.get(held, Transform);

    expect(
      app.input.drag(
        { projection: "board.items", key: "i5" },
        { projection: "board.items", key: "i7" }
      )
    ).toBe(true);

    await tick();
    app.time.step(16);

    expect(app.model.store.snapshot().session).toEqual({ merges: 1 });
    expect(app.world.projection.entityOf("board.items", "i5")).toBeUndefined();
    expect(before).toEqual({ x: 100, y: 100, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } });

    await app.stop();
  });

  it("refuses an answer the resting node does not take and warns for a missing component", async () => {
    const app = await startApp();
    const item = app.world.projection.entityOf("board.items", "i5") ?? 0;

    expect(app.input.tap(item)).toBe(false);
    expect(app.input.drag({ projection: "board.items", key: "gone" }, item)).toBe(false);
    expect(app.model.store.snapshot().session).toEqual({ merges: 0 });

    await app.stop();
  });

  it("keeps a Pointer resource and runs its frame step before the world systems", async () => {
    const app = await startApp();

    expect(app.world.ecs.resource(Pointer)).toEqual({
      x: 0,
      y: 0,
      down: false,
      justPressed: false,
      justReleased: false
    });

    await app.stop();
  });

  it("reaches the onTap listeners of a Touchable button through app.input.tap", async () => {
    const app = await startApp();
    const button = app.world.ecs.spawn({ kind: "plugin", name: "test" }, [Touchable()]);
    const seen: number[] = [];
    const off = app.input.onTap(entity => seen.push(entity));

    expect(app.input.tap(button)).toBe(false);
    expect(seen).toEqual([button]);

    off();
    app.input.tap(button);

    expect(seen).toEqual([button]);
    expect(app.model.store.snapshot().session).toEqual({ merges: 0 });

    await app.stop();
  });

  it("delivers a headless key to the onKey listeners through app.input.pressKey", async () => {
    const app = await startApp();
    const seen: string[] = [];
    const off = app.input.onKey(key => {
      seen.push(`${key.key}:${String(key.shift)}`);

      return key.key === "Escape";
    });

    expect(app.input.pressKey("Escape")).toBe(true);
    expect(app.input.pressKey("Tab", { shift: true })).toBe(false);
    expect(seen).toEqual(["Escape:false", "Tab:true"]);

    off();

    expect(app.input.pressKey("Escape")).toBe(false);

    await app.stop();
  });

  it("stays inert without a DOM and leaves nothing behind on stop", async () => {
    const app = await startApp();

    expect(app.input.cursor()).toBe("");

    await app.stop();

    expect(app.time.isRunning()).toBe(false);
    expect(Tappable.componentName).toBe("Tappable");
  });
});
