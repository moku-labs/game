import { describe, expect, it } from "vitest";
import { createApp, defineGame, exit, Transform, type } from "../../../../index";
import { rendererPlugin } from "../../../renderer";
import { Sprite } from "../../../renderer/components";
import { worldPlugin } from "../../../world";
import { projection } from "../../../world/projection/define";
import { Frames } from "../../components";
import { animPlugin } from "../../index";

// ---------------------------------------------------------------------------
// A `Frames` loop on a projection view (Delta 8, e2e defect): while the entity carries `Frames`,
// the loop owns `Sprite.texture`, so the end of a projection motion neither corrects the texture
// back to its rest key nor logs `world:view-corrected`. The real time, lifecycle, model, clock,
// flow, world and anim plugins.
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

/** The keys of the spinning coin; the rest key of the view is none of them. */
const SPIN = ["coin-0", "coin-1", "coin-2", "coin-3"] as const;

/** The texture the view declares, the value the projection would correct back to. */
const REST_KEY = "coin-rest";

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts an app with one coin projection whose views spin with `Frames` and glide on a move,
 * and mounts it with one coin.
 *
 * @returns The started app.
 */
async function startCoins() {
  const coins = projection({
    name: "board.coins",
    layer: "coins",
    from: (player: Player) => player.items,
    key: (item: Item) => item.id,
    view: (item: Item) => [
      Sprite({ texture: REST_KEY }),
      Frames({ keys: SPIN, fps: 10 }),
      Transform({ x: item.x, y: 0, rotation: 0, scale: 1 })
    ],
    motion: {
      change: { Transform: view => view.toRest(Transform, { ms: 200, ease: "linear" }) }
    }
  });
  const board = defineFeature("board", { flows: [main], projections: [coins] });
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, board],
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

  app.world.projection.setLayers([{ name: "coins", sort: "none" }]);
  app.world.projection.mount(["board.coins"], { kind: "plugin", name: "test" });
  app.time.step(16);

  return app;
}

type CoinsApp = Awaited<ReturnType<typeof startCoins>>;

/**
 * Commits a new coin list through the graph.
 *
 * @param app - The started app.
 * @param items - The new coin list.
 */
async function move(app: CoinsApp, items: Item[]): Promise<void> {
  expect(app.flow.gate.answer({ intent: "move", payload: { items } })).toBe(true);
  await tick();
}

/**
 * Steps frames of 16 ms until no track is active, and records the texture after each one.
 *
 * @param app - The started app.
 * @param entity - The view whose texture is recorded.
 * @returns The texture after every frame.
 */
function runMotion(app: CoinsApp, entity: number): Array<string | undefined> {
  const seen: Array<string | undefined> = [];

  for (let index = 0; index < 100; index += 1) {
    app.time.step(16);
    seen.push(app.world.ecs.get(entity, Sprite)?.texture);

    if (app.anim.active() === 0) break;
  }

  // Two more frames: the projection checks convergence on the frame after the motion ended.
  for (let index = 0; index < 2; index += 1) {
    app.time.step(16);
    seen.push(app.world.ecs.get(entity, Sprite)?.texture);
  }

  return seen;
}

/**
 * Counts the `world:view-corrected` entries of the log trace.
 *
 * @param app - The started app.
 * @returns How many corrections were logged.
 */
function corrections(app: CoinsApp): number {
  return app.log.trace().filter(entry => entry.event === "world:view-corrected").length;
}

describe("anim — a Frames loop on a projection view", () => {
  it("owns Sprite.texture: a motion that ends neither corrects it nor logs view-corrected", async () => {
    const app = await startCoins();
    const entity = app.world.projection.entityOf("board.coins", "a") ?? 0;

    await move(app, [{ id: "a", x: 100 }]);

    const seen = runMotion(app, entity);

    expect(app.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(corrections(app)).toBe(0);
    expect(seen).not.toContain(REST_KEY);
    expect(SPIN).toContain(app.world.ecs.get(entity, Sprite)?.texture);

    await app.stop();
  });

  it("hands Sprite.texture back to the projection when Frames is removed", async () => {
    const app = await startCoins();
    const entity = app.world.projection.entityOf("board.coins", "a") ?? 0;

    app.time.step(16);

    expect(SPIN).toContain(app.world.ecs.get(entity, Sprite)?.texture);

    app.world.ecs.remove(entity, Frames);
    await move(app, [{ id: "a", x: 100 }]);
    runMotion(app, entity);

    expect(app.world.ecs.get(entity, Sprite)?.texture).toBe(REST_KEY);

    await app.stop();
  });
});
