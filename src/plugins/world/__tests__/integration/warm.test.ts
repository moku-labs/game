import { describe, expect, it } from "vitest";
import { createApp, createPlugin, defineGame, type } from "../../../../index";
import { component } from "../../ecs/define";
import type { Entity } from "../../ecs/types";
import { worldPlugin } from "../../index";
import { projection } from "../../projection/define";

// ---------------------------------------------------------------------------
// Integration (spec 33, slice B+D): a warm window over the real time, model, clock, flow and world
// plugins. A drawing plugin's `onBuild` check is all the world needs to warm; the open comes from a
// flow answer through `model:committed`, the frames from `app.time.step`.
// ---------------------------------------------------------------------------

type Player = { coins: number };
type Session = { sheet: string };
type Sheet = { id: string; page: string; coins: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const Page = component("Page", { page: "" });
const Coins = component("Coins", { coins: 0 });

/** The settings sheet: shown while `session.sheet` names a page, kept warm on its main page. */
const settingsSheet = projection({
  name: "settings.sheet",
  layer: "ui",
  from: (player: Player, session: Session): Sheet[] =>
    session.sheet === "" ? [] : [{ id: "settings", page: session.sheet, coins: player.coins }],
  key: (sheet: Sheet) => sheet.id,
  view: (sheet: Sheet) => [Page({ page: sheet.page }), Coins({ coins: sheet.coins })],
  warm: (player: Player): Sheet => ({ id: "settings", page: "main", coins: player.coins })
});

const home = defineNode({
  outcomes: { open: type<{ page: string }>(), close: type() },
  rest: true
});

const show = defineNode({
  input: type<{ page: string }>(),
  outcomes: { done: type() },
  run: ({ session, input, out }) => {
    session.sheet = input.page;

    return out.done();
  }
});

const hide = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.sheet = "";

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, show, hide },
  start: "home",
  edges: { home: { open: "show", close: "hide" }, show: { done: "home" }, hide: { done: "home" } }
});

const settingsFeature = defineFeature("settings", {
  flows: [main],
  components: [Page, Coins],
  projections: [settingsSheet]
});

/** A drawing plugin's part of a build, done at once: what makes the world warm. */
const drawingPlugin = createPlugin("drawing", {
  depends: [worldPlugin],
  // @no-resource-check — the check stays with the world, which clears it on stop.
  onStart: ctx => {
    ctx.require(worldPlugin).projection.onBuild(() => true);
  }
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts the app with the sheet closed and mounts the sheet.
 *
 * @returns The started app.
 */
async function startApp() {
  const app = createApp({
    plugins: [worldPlugin, settingsFeature, drawingPlugin],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { coins: 5 }, initialSession: { sheet: "" }, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount(["settings.sheet"], { kind: "plugin", name: "test" });

  return app;
}

describe("warm window integration", () => {
  // Bug: the world never warms in a real app (the frame step is not wired, or the real `time` has no rate it can
  // read), or the open through a flow answer spawns a second view beside the held one.
  it("holds the sheet built while closed, shows the same entity on the answer that opens it, and holds a new one after the close", async () => {
    const app = await startApp();
    const pages = (): Entity[] => [...app.world.ecs.query(Page)].map(([entity]) => entity);

    app.time.step(16);

    const [held] = pages();

    expect(pages()).toHaveLength(1);
    expect(app.world.projection.isBuilding(held ?? 0)).toBe(true);
    expect(app.world.projection.left()).toBeLessThan(Number.POSITIVE_INFINITY);

    app.time.step(16);

    expect(app.world.projection.left()).toBe(Number.POSITIVE_INFINITY);
    expect(app.world.projection.entityOf("settings.sheet", "settings")).toBeUndefined();

    expect(app.flow.gate.answer({ intent: "open", payload: { page: "audio" } })).toBe(true);
    await tick();
    app.time.step(16);

    expect(app.world.projection.entityOf("settings.sheet", "settings")).toBe(held);
    expect(app.world.projection.isBuilding(held ?? 0)).toBe(false);
    expect(app.world.ecs.get(held ?? 0, Page)).toEqual({ page: "audio" });
    expect(pages()).toEqual([held]);

    expect(app.flow.gate.answer({ intent: "close" })).toBe(true);
    await tick();
    app.time.step(16);

    const [again] = pages();

    expect(pages()).toHaveLength(1);
    expect(again).not.toBe(held);
    expect(app.world.projection.isBuilding(again ?? 0)).toBe(true);
    expect(app.world.ecs.get(again ?? 0, Page)).toEqual({ page: "main" });

    await app.stop();
  });
});
