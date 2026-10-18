import { describe, expect, it } from "vitest";
import {
  createApp,
  defineGame,
  defineMotion,
  defineScene,
  Order,
  projection,
  screen,
  Transform,
  type
} from "../../../../index";
import type { CompiledMessages } from "../../../i18n/types";
import type { Entity } from "../../../world/types";

// ---------------------------------------------------------------------------
// Integration (F23): a projection both scenes list stays mounted across the
// switch. Its entities survive, its elements play no exit and no enter, and its
// screen root draws at its place in the new scene's list. A projection only one
// scene lists unmounts and mounts as before. The real flow runner, world, ui,
// anim and scenes in plain Bun; the renderer is inert.
// ---------------------------------------------------------------------------

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: string;
  strings: { "kept.title": Record<string, never> };
}>();

/** The one compiled locale of the fixture. */
const english: CompiledMessages = {
  "kept.title": () => [{ kind: "text", text: "kept" }]
};

/** A motion that plays its enter and its exit whatever brings the element, a mount included. */
const presence = defineMotion({
  states: { small: { Transform: { scale: 0.5 } } },
  transition: { ms: 200 },
  on: { enter: "small", exit: "small" }
});

/** The HUD both scenes list: a panel with a number, entering and leaving with a motion. */
const sharedHud = projection({
  name: "shared.hud",
  layer: "ui",
  from: () => ({ id: "shared" }),
  view: () => (
    <stack key="sharedRoot" style={{ width: 400, height: 200 }} motion={presence}>
      <text key="sharedCoins" content="100" />
    </stack>
  )
});

/** A screen only the ward lists. */
const wardOnly = projection({
  name: "ward.only",
  layer: "ui",
  from: () => ({ id: "ward" }),
  view: () => <stack key="wardRoot" style={{ width: 1080, height: 1920 }} />
});

/** A screen only the board lists. */
const boardOnly = projection({
  name: "board.only",
  layer: "ui",
  from: () => ({ id: "board" }),
  view: () => <stack key="boardRoot" style={{ width: 1080, height: 1920 }} />
});

/** The ward lists the HUD last: its root draws at -1. */
const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: {},
  projections: [wardOnly, sharedHud]
});

/** The board lists the HUD first of two: its root draws at -2. */
const boardScene = defineScene("board", {
  bundle: "board",
  layers: {},
  projections: [sharedHud, boardOnly]
});

const ward = defineNode({ rest: true, scene: "ward", outcomes: { board: type() } });

const board = defineNode({ rest: true, scene: "board", outcomes: { back: type() } });

const main = defineFlow("main", {
  nodes: { ward, board },
  start: "ward",
  outcomes: {},
  edges: { ward: { board: "board" }, board: { back: "ward" } }
});

const keptFeature = defineFeature("kept", {
  flows: [main],
  scenes: [wardScene, boardScene],
  projections: [sharedHud, wardOnly, boardOnly],
  strings: { en: english }
});

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many turns to give it.
 */
async function tick(times = 80): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Lets the runner move, then steps frames until the screen stands: the motions of a mount last
 * 200 ms.
 *
 * @param app - The running app.
 * @param app.time - Its time plugin.
 * @param app.time.step - Steps one frame.
 */
async function settle(app: { time: { step(deltaMs: number): void } }): Promise<void> {
  await tick();

  for (let frame = 0; frame < 20; frame += 1) app.time.step(16);
}

/**
 * Starts the screen set headless with the flow resting on the ward, and the ward standing.
 *
 * @returns The started app.
 */
async function startApp() {
  const app = createApp({
    plugins: [...screen, keptFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: {}, initialSession: {}, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await settle(app);

  return app;
}

/** The app `startApp` builds. */
type KeptApp = Awaited<ReturnType<typeof startApp>>;

/**
 * The entity of a keyed element, failing the test when it is not mounted.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity.
 */
function elementOf(app: KeptApp, key: string): Entity {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  expect(entity).toBeDefined();

  return entity ?? 0;
}

describe("a switch between two scenes that both list a projection", () => {
  it("keeps its entities, plays no exit and no enter, and draws its root at its new place", async () => {
    const app = await startApp();
    const view = app.world.projection.entityOf("shared.hud", "shared.hud");
    const root = elementOf(app, "sharedRoot");
    const coins = elementOf(app, "sharedCoins");

    expect(app.world.ecs.get(root, Order)?.value).toBe(-1);

    app.flow.gate.answer({ intent: "board" });
    await tick();
    app.time.step(16);

    expect(app.scenes.current()).toBe("board");
    expect(app.world.projection.entityOf("shared.hud", "shared.hud")).toBe(view);
    expect(elementOf(app, "sharedRoot")).toBe(root);
    expect(elementOf(app, "sharedCoins")).toBe(coins);
    expect(app.world.projection.motionsOf(root)).toEqual([]);
    expect(app.world.ecs.get(root, Transform)?.scale).toBe(1);
    expect(app.world.ecs.get(view ?? 0, Order)?.value).toBe(-2);
    expect(app.world.ecs.get(root, Order)?.value).toBe(-2);

    await app.stop();
  });

  // Bug: ui learns the new place from the frame's change list, which phase `signals` empties in
  // every mode while phase `layout` sleeps in a paused world: the kept root keeps its old order.
  it("draws its root at its new place once a world paused across the switch runs again", async () => {
    const app = await startApp();
    const root = elementOf(app, "sharedRoot");

    app.world.ecs.setMode("paused");
    app.flow.gate.answer({ intent: "board" });
    await tick();
    app.time.step(16);
    app.time.step(16);

    expect(app.scenes.current()).toBe("board");

    app.world.ecs.setMode("live");
    app.time.step(16);

    expect(elementOf(app, "sharedRoot")).toBe(root);
    expect(app.world.ecs.get(root, Order)?.value).toBe(-2);

    await app.stop();
  });

  it("unmounts and mounts a projection only one of them lists, as before", async () => {
    const app = await startApp();
    const wardView = app.world.projection.entityOf("ward.only", "ward.only");

    expect(wardView).toBeDefined();

    app.flow.gate.answer({ intent: "board" });
    await settle(app);

    expect(app.world.projection.entityOf("ward.only", "ward.only")).toBeUndefined();
    expect(app.world.ecs.ownerOf(wardView ?? 0)).toBeUndefined();
    expect(app.world.projection.entityOf("board.only", "board.only")).toBeDefined();
    expect(elementOf(app, "boardRoot")).toBeDefined();

    await app.stop();
  });
});
