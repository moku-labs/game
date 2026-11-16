import { describe, expect, it } from "vitest";
import { createApp, defineGame, exit, Transform, type } from "../../../../index";
import { read } from "../../../flow/doors/read";
import { sources } from "../../../flow/doors/sources";
import { rendererPlugin } from "../../../renderer";
import { worldPlugin } from "../../../world";
import { component } from "../../../world/ecs/define";
import { projection } from "../../../world/projection/define";
import { animPlugin } from "../../index";
import { defineMotion } from "../../motion";

// ---------------------------------------------------------------------------
// F192 on the real time, flow, world and anim plugins: a `defineMotion({ id })` view that enters
// answers its label through `world.projection.motionIdsOf` and `game.explain`, and nothing after
// the enter ends.
// ---------------------------------------------------------------------------

type Item = { id: string };
type Player = { items: Item[] };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Record<string, never>;
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
  run: ({ player, input, out }) => {
    player.items = input.items.map(item => ({ ...item }));

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, apply },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { move: "apply", quit: exit("over") }, apply: { done: "home" } }
});

/** A card that grows in over 300 ms when a commit adds it. */
const hudCard = defineMotion({
  id: "hud.card",
  states: { small: { Transform: { scale: 0.5 } } },
  transition: { ms: 300, ease: "linear" },
  on: { enter: "small" }
});

/** A card without an id: its enter starts an unlabelled track. */
const plainCard = defineMotion({
  states: { small: { Transform: { scale: 0.5 } } },
  transition: { ms: 300, ease: "linear" },
  on: { enter: "small" }
});

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts an app with one projection of cards and mounts it with the card "a".
 *
 * @param motion - The motion of every card.
 * @returns The started app.
 */
async function startCards(motion: typeof hudCard) {
  const cards = projection({
    name: "hud.cards",
    layer: "cards",
    from: (player: Player) => player.items,
    key: (item: Item) => item.id,
    view: (item: Item) => [
      Label({ id: item.id }),
      Transform({ x: 0, y: 0, rotation: 0, scale: 1 })
    ],
    motion
  });
  const hud = defineFeature("hud", { flows: [main], projections: [cards] });
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, hud],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { items: [{ id: "a" }] }, initialSession: {}, seed: 1 },
      log: { mode: "test" }
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
 * Commits a card list through the graph, so the new cards enter.
 *
 * @param app - The started app.
 * @param ids - The card ids.
 */
async function commit(app: CardsApp, ids: string[]): Promise<void> {
  const items = ids.map(id => ({ id }));

  expect(app.flow.gate.answer({ intent: "move", payload: { items } })).toBe(true);
  await tick();
}

describe("anim — defineMotion id through world and explain", () => {
  it("shows hud.card.enter mid-enter in motionIdsOf and in game.explain, and nothing after it ends", async () => {
    const app = await startCards(hudCard);

    await commit(app, ["a", "b"]);
    app.time.step(16);

    const entity = app.world.projection.entityOf("hud.cards", "b") ?? 0;

    expect(app.world.projection.motionIdsOf(entity)).toEqual(["hud.card.enter"]);
    expect(read(app, sources.explain, { entity })?.motionIds).toEqual(["hud.card.enter"]);

    for (let frame = 0; frame < 25; frame += 1) app.time.step(16);

    expect(app.anim.active()).toBe(0);
    expect(app.world.projection.motionIdsOf(entity)).toEqual([]);
    expect(read(app, sources.explain, { entity })).not.toHaveProperty("motionIds");

    await app.stop();
  });

  it("gives an unlabelled motion no motionIds, also mid-enter", async () => {
    const app = await startCards(plainCard);

    await commit(app, ["a", "b"]);
    app.time.step(16);

    const entity = app.world.projection.entityOf("hud.cards", "b") ?? 0;

    expect(app.anim.active()).toBe(1);
    expect(app.world.projection.motionIdsOf(entity)).toEqual([]);
    expect(read(app, sources.explain, { entity })).not.toHaveProperty("motionIds");

    await app.stop();
  });
});
