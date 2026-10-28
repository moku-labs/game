import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, type Flow, screen, Transform, type } from "../../../../index";
import { projection } from "../../../world/projection/define";
import { Draggable, DropTarget, Tappable } from "../../components";

// ---------------------------------------------------------------------------
// Integration: the presses a guide's narrow drops answer its `blocked` (F108).
// The real time, lifecycle, model, clock, flow, world, renderer and input
// plugins, headless. The doors `tap` and `drag` do no hit test, so the lock of
// the window never refuses them: they are presses inside the window, and only
// the gate's narrow decides what they answer.
// ---------------------------------------------------------------------------

type Item = { cell: string };
type Session = {
  guided: boolean;
  withBlocked: boolean;
  merges: number;
  selects: number;
  scolds: number[];
};

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { items: Item[] };
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** The one answer the tutorial step lets through: the item of c2 onto c3. */
const ALLOW = { intent: "merge", payload: { from: "c2", to: "c3" } };

/** The answer of a blocked press, with its payload. */
const BLOCKED = { intent: "tutorialBlocked", payload: { step: 2 } };

const boardItems = projection({
  name: "board.items",
  layer: "items",
  from: (player: { items: Item[] }) => player.items,
  key: (item: Item) => item.cell,
  view: (item: Item) => [
    Transform({ x: 100, y: 100 }),
    Draggable({ payload: { from: item.cell } }),
    DropTarget({ intent: "merge", payload: { to: item.cell } })
  ]
});

const board = defineNode({
  rest: true,
  outcomes: {
    merge: type<{ from: string; to: string }>(),
    select: type<{ id: string }>(),
    tutorialBlocked: type<{ step: number }>()
  },
  guide: ({ session }): Flow.GuideOptions | undefined => {
    if (!session.guided) return undefined;

    const options: Flow.GuideOptions = {
      allow: ALLOW,
      target: [
        { projection: "board.items", key: "c2" },
        { projection: "board.items", key: "c3" }
      ]
    };

    return session.withBlocked ? { ...options, blocked: BLOCKED } : options;
  }
});

const applyMerge = defineNode({
  input: type<{ from: string; to: string }>(),
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.merges += 1;
    session.guided = false;

    return out.done();
  }
});

const applySelect = defineNode({
  input: type<{ id: string }>(),
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.selects += 1;

    return out.done();
  }
});

const scold = defineNode({
  input: type<{ step: number }>(),
  outcomes: { done: type() },
  run: ({ session, input, out }) => {
    session.scolds.push(input.step);

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { board, applyMerge, applySelect, scold },
  start: "board",
  edges: {
    board: { merge: "applyMerge", select: "applySelect", tutorialBlocked: "scold" },
    applyMerge: { done: "board" },
    applySelect: { done: "board" },
    scold: { done: "board" }
  }
});

const boardFeature = defineFeature("board", { flows: [main], projections: [boardItems] });

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts the board at the tutorial step, with the items c2, c3 and c4 and two buttons: `select`
 * answers an outcome of the node, `shop` answers none.
 *
 * @param withBlocked - Whether the guide names `blocked`.
 * @returns The started app and the two buttons.
 */
async function startBoard(withBlocked: boolean) {
  const app = createApp({
    plugins: [...screen, boardFeature],
    pluginConfigs: {
      flow: { mainFlow: main, holdMs: Number.POSITIVE_INFINITY },
      model: {
        initialPlayer: { items: [{ cell: "c2" }, { cell: "c3" }, { cell: "c4" }] },
        initialSession: { guided: true, withBlocked, merges: 0, selects: 0, scolds: [] },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "items", sort: "none" }]);
  app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });
  app.time.step(16);

  const owner = { kind: "plugin", name: "test" } as const;
  const select = app.world.ecs.spawn(owner, [
    Tappable({ intent: "select", payload: { id: "lamp" } })
  ]);
  const shop = app.world.ecs.spawn(owner, [Tappable({ intent: "shop" })]);

  return { app, select, shop };
}

/**
 * The item of a cell, by its key.
 *
 * @param cell - The cell key.
 * @returns The projection target.
 */
function item(cell: string): { projection: string; key: string } {
  return { projection: "board.items", key: cell };
}

describe("a press inside the window that the guide's narrow drops", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Bug caught: a press on a button inside the window answers nothing, so the tutorial goes silent.
  it("answers blocked with its payload, once, for another outcome and for no outcome", async () => {
    const { app, select, shop } = await startBoard(true);

    expect(app.input.tap(select)).toBe(true);
    await tick();

    expect(app.model.store.snapshot().session).toMatchObject({ selects: 0, scolds: [2] });
    expect(app.flow.state().path).toBe("board");

    expect(app.input.tap(shop)).toBe(true);
    await tick();

    expect(app.model.store.snapshot().session).toMatchObject({ selects: 0, scolds: [2, 2] });

    await app.stop();
  });

  // Bug caught: a guide without blocked turns a stray press into some answer.
  it("answers nothing when the guide names no blocked: the node still waits", async () => {
    const { app, select } = await startBoard(false);

    expect(app.input.tap(select)).toBe(false);
    await tick();

    expect(app.model.store.snapshot().session).toMatchObject({ selects: 0, scolds: [] });
    expect(app.flow.state().path).toBe("board");
    expect(app.flow.gate.state()).toMatchObject({ open: true, narrowed: true });

    await app.stop();
  });

  // Bug caught: a drop on the wrong cell is lost, or the right one is turned into blocked.
  it("answers blocked for the allowed intent with another payload, and the right drop itself", async () => {
    const { app } = await startBoard(true);

    expect(app.input.drag(item("c2"), item("c4"))).toBe(true);
    await tick();

    expect(app.model.store.snapshot().session).toMatchObject({ merges: 0, scolds: [2] });

    expect(app.input.drag(item("c2"), item("c3"))).toBe(true);
    await tick();

    expect(app.model.store.snapshot().session).toMatchObject({ merges: 1, scolds: [2] });

    await app.stop();
  });

  // Bug caught: a press at a closed gate is converted to blocked and played on the next gate.
  it("is held, not converted, at a closed gate: the next gate takes the press itself", async () => {
    // A frame source that never calls back: time runs, so the closed gate holds the press.
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    const { app, select } = await startBoard(true);

    expect(app.input.drag(item("c2"), item("c3"))).toBe(true);
    expect(app.flow.gate.state()).toMatchObject({ open: false, narrowed: true, blocked: BLOCKED });
    expect(app.input.tap(select)).toBe(false);
    await tick();

    expect(app.model.store.snapshot().session).toMatchObject({
      guided: false,
      merges: 1,
      selects: 1,
      scolds: []
    });

    await app.stop();
  });
});
