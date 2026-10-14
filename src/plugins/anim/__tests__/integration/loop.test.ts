import { describe, expect, it } from "vitest";
import { createApp, defineGame, exit, Transform, type } from "../../../../index";
import { rendererPlugin } from "../../../renderer";
import { worldPlugin } from "../../../world";
import { component } from "../../../world/ecs/define";
import { projection } from "../../../world/projection/define";
import { animPlugin } from "../../index";
import { defineMotion } from "../../motion";

// ---------------------------------------------------------------------------
// A `defineMotion` loop on a real projection: the real time, lifecycle, model, clock, flow,
// world and anim plugins. Delta 6, item B6.
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

const Label = component("Label", { id: "" });

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

/** A sway of 400 ms: 0.1 rad to one side and back. */
const sway = defineMotion({
  keyframes: {
    sway: [
      { at: 0, Transform: { rotation: 0 } },
      { at: 0.5, ease: "linear", Transform: { rotation: 0.1 } },
      { at: 1, ease: "linear", Transform: { rotation: 0 } }
    ]
  },
  transition: { ms: 400 },
  loop: { track: "sway" },
  on: {}
});

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/** A filter value: the strength of a glint. */
const Glint = component("Glint", { amount: 0.2 });

/** The glints' cycle: up in 500 ms, a hold of 3 s, down in 500 ms, forever. */
const GLINT_CYCLE = [
  { at: 0.125, ease: "linear", to: { amount: 0.6 } },
  { at: 0.875, ease: "linear", to: { amount: 0.6 } },
  { at: 1, ease: "linear", to: { amount: 0.2 } }
] as const;

/**
 * The card projection: the views sway, or glint when `glints` is set.
 *
 * @param glints - True for the glint cycle on a `Glint` component instead of the sway.
 * @returns The projection spec.
 */
function cardsProjection(glints: boolean) {
  if (glints) {
    return projection({
      name: "hud.cards",
      layer: "cards",
      from: (player: Player) => player.items,
      key: (item: Item) => item.id,
      view: (item: Item) => [Label({ id: item.id }), Glint({ amount: 0.2 })],
      motion: {
        loop: view =>
          view.tween(Glint, { amount: 0.2 }, { ms: 4000, repeat: "forever", segments: GLINT_CYCLE })
      }
    });
  }

  return projection({
    name: "hud.cards",
    layer: "cards",
    from: (player: Player) => player.items,
    key: (item: Item) => item.id,
    view: (item: Item) => [
      Label({ id: item.id }),
      Transform({ x: item.x, y: 0, rotation: 0, scale: 1 })
    ],
    motion: sway
  });
}

/**
 * Starts an app with one card projection whose views sway (or glint), and mounts it with one card.
 *
 * @param glints - True for the glint cycle instead of the sway.
 * @returns The started app.
 */
async function startCards(glints = false) {
  const cards = cardsProjection(glints);
  const hud = defineFeature("hud", { flows: [main], projections: [cards] });
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, hud],
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

  app.world.projection.setLayers([{ name: "cards", sort: "none" }]);
  app.world.projection.mount(["hud.cards"], { kind: "plugin", name: "test" });
  app.time.step(16);

  return app;
}

type CardsApp = Awaited<ReturnType<typeof startCards>>;

/**
 * Commits a new card list through the graph.
 *
 * @param app - The started app.
 * @param items - The new card list.
 */
async function move(app: CardsApp, items: Item[]): Promise<void> {
  expect(app.flow.gate.answer({ intent: "move", payload: { items } })).toBe(true);
  await tick();
}

/**
 * Reads the rotation of the view of one card.
 *
 * @param app - The started app.
 * @param key - The card id.
 * @returns Its rotation.
 */
function rotationOf(app: CardsApp, key: string): number | undefined {
  const entity = app.world.projection.entityOf("hud.cards", key) ?? 0;

  return app.world.ecs.get(entity, Transform)?.rotation;
}

describe("anim — a defineMotion loop on a projection", () => {
  it("starts when enter plays, and in the first live frame after a direct mount", async () => {
    const app = await startCards();

    // The direct mount plays no hook: the card owed its loop, and the first frame started it.
    expect(app.anim.active()).toBe(1);
    expect(rotationOf(app, "a")).toBe(0);

    await move(app, [
      { id: "a", x: 0 },
      { id: "b", x: 100 }
    ]);
    app.time.step(16);

    // The second card entered on an edge: its loop started with enter, next to the first one.
    expect(app.anim.active()).toBe(2);

    for (let frame = 0; frame < 50; frame += 1) app.time.step(16);

    // 51 frames of 16 ms = 816 ms: two whole cycles and 16 ms of the third, 0.1 × 16 / 200 in.
    expect(rotationOf(app, "b")).toBeCloseTo(0.008, 6);
    // The mounted card started one frame earlier and is advanced from the frame after: 51 too.
    expect(rotationOf(app, "a")).toBeCloseTo(0.008, 6);
    expect(app.anim.active()).toBe(2);

    await app.stop();
  });

  it("stands through the fast frames of the flow and runs on when the flow is live again", async () => {
    const app = await startCards();

    app.time.step(100);

    expect(app.anim.active()).toBe(1);
    expect(rotationOf(app, "a")).toBeCloseTo(0.05, 6);

    // The flow walks fast and commits nothing: no reconcile, so nothing flushes the view.
    app.flow.setMode("fast");
    app.time.step(16);
    app.time.step(16);

    // A fast frame ends what has an end. The loop has none: it stands where it is.
    expect(app.anim.active()).toBe(1);
    expect(rotationOf(app, "a")).toBeCloseTo(0.05, 6);

    app.flow.setMode("live");
    app.time.step(100);

    expect(app.anim.active()).toBe(1);
    expect(rotationOf(app, "a")).toBeCloseTo(0.1, 6);

    await app.stop();
  });

  it("dies on flushAll (fast mode), starts again when the world is live, and dies with its view", async () => {
    const app = await startCards();
    const both = [
      { id: "a", x: 0 },
      { id: "b", x: 100 }
    ];

    await move(app, both);
    app.time.step(16);
    // Fast mode flushes every projection: the loop dies and the view stands at rest.
    app.world.ecs.setMode("fast");

    expect(app.anim.active()).toBe(0);
    expect(rotationOf(app, "b")).toBe(0);

    app.world.ecs.setMode("live");

    await move(app, [{ id: "a", x: 0 }]);
    app.time.step(16);
    app.time.step(16);
    await move(app, both);
    app.time.step(16);

    // The card that stayed owed its loop after the flush and got it back in a live frame. The
    // card that entered again started its own.
    expect(app.anim.active()).toBe(2);

    await move(app, [{ id: "a", x: 0 }]);
    app.time.step(16);
    app.time.step(16);

    // Only the loop of the card that left died with its view.
    expect(app.world.projection.entityOf("hud.cards", "b")).toBeUndefined();
    expect(app.anim.active()).toBe(1);

    await app.stop();
  });
});

describe("anim — a glint cycle with a pause on the real world", () => {
  it("marks its component changed in no frame of the pause, and in every frame it moves", async () => {
    const app = await startCards(true);
    const entity = app.world.projection.entityOf("hud.cards", "a") ?? 0;
    const frames: Array<{ marked: boolean; amount: number | undefined }> = [];

    // After anim wrote the frame (animate) and before the world forgets its marks (signals).
    app.time.onFrame("sync", () => {
      frames.push({
        marked: [...app.world.ecs.changed(Glint)].includes(entity),
        amount: app.world.ecs.get(entity, Glint)?.amount
      });
    });

    for (let frame = 0; frame < 300; frame += 1) app.time.step(16);

    let held = 0;
    let longestHold = 0;

    for (const [index, seen] of frames.entries()) {
      const moved = index === 0 || seen.amount !== frames[index - 1]?.amount;

      // A frame is marked exactly when the value moved: the hold marks nothing.
      expect(seen.marked).toBe(moved);
      held = moved ? 0 : held + 1;
      longestHold = Math.max(longestHold, held);
    }

    // The 3 s hold stands as some 187 frames of 16 ms in a row with no mark.
    expect(longestHold).toBeGreaterThan(180);

    await app.stop();
  });
});
