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

/**
 * Starts an app with one card projection whose views sway, and mounts it with one card.
 *
 * @returns The started app.
 */
async function startCards() {
  const cards = projection({
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
  it("starts when enter plays and never on the direct mount", async () => {
    const app = await startCards();

    expect(app.anim.active()).toBe(0);
    expect(rotationOf(app, "a")).toBe(0);

    await move(app, [
      { id: "a", x: 0 },
      { id: "b", x: 100 }
    ]);
    app.time.step(16);

    expect(app.anim.active()).toBe(1);

    for (let frame = 0; frame < 50; frame += 1) app.time.step(16);

    // 51 frames of 16 ms = 816 ms: two whole cycles and 16 ms of the third, 0.1 × 16 / 200 in.
    expect(rotationOf(app, "b")).toBeCloseTo(0.008, 6);
    expect(rotationOf(app, "a")).toBe(0);
    expect(app.anim.active()).toBe(1);

    await app.stop();
  });

  it("dies on flushAll (fast mode) and with its view", async () => {
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

    expect(app.anim.active()).toBe(1);

    await move(app, [{ id: "a", x: 0 }]);
    app.time.step(16);
    app.time.step(16);

    expect(app.world.projection.entityOf("hud.cards", "b")).toBeUndefined();
    expect(app.anim.active()).toBe(0);

    await app.stop();
  });
});
