import { describe, expect, it } from "vitest";
import {
  animPlugin,
  createApp,
  defineGame,
  exit,
  Frames,
  projection,
  rendererPlugin,
  Sprite,
  Transform,
  type,
  worldPlugin
} from "../../../../index";

// ---------------------------------------------------------------------------
// Integration: `initialOnly` next to a `Frames` loop. `anim` mutes `Sprite.texture` in its
// `onAdded(Frames)`, which fires inside the spawn of a view, before the projection gives the view
// its `initialOnly` fields. Both have to hold: the end of the fade-in corrects neither the texture
// the loop writes nor the tint a system writes, and taking `Frames` off hands the texture back to
// the projection while the tint stays the system's. The real time, lifecycle, model, clock, flow,
// world, renderer and anim plugins.
// ---------------------------------------------------------------------------

type Coin = { id: string; x: number };
type Player = { coins: Coin[] };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** The keys of the spinning coin; the texture the view declares is none of them. */
const SPIN = ["coin-0", "coin-1", "coin-2", "coin-3"] as const;

/** The texture the view declares, the value the projection would correct back to. */
const REST_KEY = "coin-rest";

/** The tint the view draws at birth. */
const BIRTH_TINT = 0xff_ff_ff;

/** The tint the "system" draws after the birth: a hit flash. */
const FLASH_TINT = 0xff_00_00;

/** How long the coin fades in. */
const FADE_MS = 200;

const coins = projection({
  name: "board.coins",
  layer: "coins",
  from: (player: Player) => player.coins,
  key: (coin: Coin) => coin.id,
  view: (coin: Coin) => [
    Sprite({ texture: REST_KEY, tint: BIRTH_TINT }),
    Frames({ keys: SPIN, fps: 10 }),
    Transform({ x: coin.x, y: 0, rotation: 0, scale: 1 })
  ],
  motion: {
    enter: view => {
      view.set(Sprite, { alpha: 0 });

      return view.tween(Sprite, { alpha: 1 }, { ms: FADE_MS, ease: "linear" });
    },
    change: { Transform: view => view.toRest(Transform, { ms: 200, ease: "linear" }) }
  },
  initialOnly: [[Sprite, ["tint"]]]
});

const home = defineNode({
  rest: true,
  outcomes: { move: type<{ coins: Coin[] }>(), quit: type() }
});

const apply = defineNode({
  input: type<{ coins: Coin[] }>(),
  outcomes: { done: type() },
  run: ({ player, input, out }) => {
    player.coins = input.coins.map(coin => ({ ...coin }));

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, apply },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { move: "apply", quit: exit("over") }, apply: { done: "home" } }
});

const board = defineFeature("board", { flows: [main], projections: [coins] });

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts an app with the coin projection mounted over no coin.
 *
 * @returns The started app.
 */
async function startBoard() {
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, board],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { coins: [] }, initialSession: {}, seed: 1 }
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

type BoardApp = Awaited<ReturnType<typeof startBoard>>;

/**
 * Commits a new coin list through the graph; the next frame reconciles it with motions.
 *
 * @param app - The started app.
 * @param list - The new coin list.
 */
async function move(app: BoardApp, list: Coin[]): Promise<void> {
  expect(app.flow.gate.answer({ intent: "move", payload: { coins: list } })).toBe(true);
  await tick();
}

/**
 * Steps frames of 16 ms until no track is active and two more, the frame of the convergence check
 * among them, and records the texture of the coin after each one.
 *
 * @param app - The started app.
 * @returns The texture after every frame.
 */
function runMotion(app: BoardApp): Array<string | undefined> {
  const seen: Array<string | undefined> = [];
  const textureNow = (): string | undefined => {
    const entity = app.world.projection.entityOf("board.coins", "a");

    return entity === undefined ? undefined : app.world.ecs.get(entity, Sprite)?.texture;
  };

  for (let index = 0; index < 100; index += 1) {
    app.time.step(16);
    seen.push(textureNow());

    if (app.anim.active() === 0) break;
  }

  for (let index = 0; index < 2; index += 1) {
    app.time.step(16);
    seen.push(textureNow());
  }

  return seen;
}

/**
 * Counts the `world:view-corrected` entries of the log trace.
 *
 * @param app - The started app.
 * @returns How many corrections were logged.
 */
function corrections(app: BoardApp): number {
  return app.log.trace().filter(entry => entry.event === "world:view-corrected").length;
}

describe("world — initialOnly next to a Frames loop", () => {
  // Bug: the birth gives the view the projection's shared table in place of the one `anim` made
  // for `Sprite.texture` inside the spawn, so the end of the fade-in writes the rest key over the
  // spinning coin and warns `world:view-corrected`, and taking `Frames` off releases nothing.
  it("keeps the loop's texture through the end of the fade-in, and hands it back with Frames", async () => {
    const app = await startBoard();

    await move(app, [{ id: "a", x: 0 }]);

    const faded = runMotion(app);
    const entity = app.world.projection.entityOf("board.coins", "a") ?? 0;

    expect(app.world.ecs.get(entity, Sprite)?.alpha).toBe(1);
    expect(faded).not.toContain(REST_KEY);
    expect(SPIN).toContain(app.world.ecs.get(entity, Sprite)?.texture);
    expect(corrections(app)).toBe(0);

    app.world.ecs.set(entity, Sprite, { tint: FLASH_TINT });
    app.world.ecs.remove(entity, Frames);
    await move(app, [{ id: "a", x: 100 }]);
    runMotion(app);

    expect(app.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(app.world.ecs.get(entity, Sprite)?.texture).toBe(REST_KEY);
    expect(app.world.ecs.get(entity, Sprite)?.tint).toBe(FLASH_TINT);

    await app.stop();
  });
});
