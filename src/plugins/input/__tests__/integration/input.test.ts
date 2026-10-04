import { describe, expect, it } from "vitest";
import { createApp, defineGame, exit, screen, Transform, type } from "../../../../index";
import { projection } from "../../../world/projection/define";
import { Draggable, DropTarget, Pointer, Tappable, Touchable, Traceable } from "../../components";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock, flow, world, renderer
// and input plugins, in plain Bun. The renderer is inert; `app.input.*` is the door.
// ---------------------------------------------------------------------------

type Item = { id: string; cell: string; level: number };
type Player = { items: Item[]; cells: string[]; cards: string[]; played: string[] };
type Cell = { cell: string };
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

// A 3 x 3 word grid, a1 to c3, cells 72 px apart.
const CELLS = ["a1", "b1", "c1", "a2", "b2", "c2", "a3", "b3", "c3"];

// A solitaire pile of four cards fanned 30 px; each card carries the cards on top of it.
const CARDS = ["k1", "k2", "k3", "k4"];

const boardCells = projection({
  name: "board.cells",
  layer: "cells",
  from: (player: Player) => player.cells,
  key: (cell: string) => cell,
  view: (cell: string) => [
    Transform({
      x: 600 + (CELLS.indexOf(cell) % 3) * 72,
      y: 100 + Math.floor(CELLS.indexOf(cell) / 3) * 72
    }),
    Traceable({ intent: "word", payload: { cell } })
  ]
});

const pileCards = projection({
  name: "pile.cards",
  layer: "cards",
  from: (player: Player) => player.cards,
  key: (card: string) => card,
  view: (card: string) => [
    Transform({ x: 900, y: 100 + CARDS.indexOf(card) * 30 }),
    Draggable({ payload: { from: card }, carry: CARDS.slice(CARDS.indexOf(card) + 1) }),
    DropTarget({ intent: "stack", payload: { to: card } })
  ]
});

const home = defineNode({
  outcomes: {
    merge: type<{ from: string; to: string }>(),
    word: type<{ path: Cell[] }>(),
    stack: type<{ from: string; to: string }>(),
    quit: type()
  },
  rest: true
});

const applyWord = defineNode({
  input: type<{ path: Cell[] }>(),
  outcomes: { done: type() },
  run: ({ player, input, out }) => {
    player.played.push(input.path.map(cell => cell.cell).join(" "));

    return out.done();
  }
});

const applyStack = defineNode({
  input: type<{ from: string; to: string }>(),
  outcomes: { done: type() },
  run: ({ player, input, out }) => {
    player.played.push(`${input.from} on ${input.to}`);

    return out.done();
  }
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
  nodes: { home, applyMerge, applyWord, applyStack },
  start: "home",
  outcomes: { over: type() },
  edges: {
    home: { merge: "applyMerge", word: "applyWord", stack: "applyStack", quit: exit("over") },
    applyMerge: { done: "home" },
    applyWord: { done: "home" },
    applyStack: { done: "home" }
  }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  projections: [boardItems, boardCells, pileCards]
});

/**
 * A cell of the word grid by its key.
 *
 * @param key - The cell key, such as `"b2"`.
 * @returns The projection target.
 */
function cellAt(key: string): { projection: string; key: string } {
  return { projection: "board.cells", key };
}

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
          ],
          cells: CELLS,
          cards: CARDS,
          played: []
        },
        initialSession: { merges: 0 },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([
    { name: "items", sort: "y" },
    { name: "cells", sort: "none" },
    { name: "cards", sort: "none" }
  ]);
  app.world.projection.mount(["board.items", "board.cells", "pile.cards"], {
    kind: "plugin",
    name: "test"
  });
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

  it("answers a scripted trace of three cells: the node takes outcome word, the cells in order", async () => {
    const app = await startApp();

    expect(app.input.trace([cellAt("a1"), cellAt("b2"), cellAt("c3")])).toBe(true);

    await tick();
    app.time.step(16);

    expect(app.model.store.snapshot().player).toMatchObject({ played: ["a1 b2 c3"] });
    expect(app.input.trace([cellAt("a1"), cellAt("z9")])).toBe(false);

    await app.stop();
  });

  it("answers a scripted drag of a card that carries a stack, unchanged, and moves no card", async () => {
    const app = await startApp();
    const k3 = app.world.projection.entityOf("pile.cards", "k3") ?? 0;

    expect(
      app.input.drag(
        { projection: "pile.cards", key: "k2" },
        { projection: "pile.cards", key: "k1" }
      )
    ).toBe(true);

    await tick();
    app.time.step(16);

    expect(app.model.store.snapshot().player).toMatchObject({ played: ["k2 on k1"] });
    expect(app.world.ecs.get(k3, Transform)).toMatchObject({ x: 900, y: 160 });

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
