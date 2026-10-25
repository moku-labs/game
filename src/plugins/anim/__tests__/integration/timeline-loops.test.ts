import { afterEach, describe, expect, it, vi } from "vitest";
import type { World } from "../../../../index";
import {
  component,
  createApp,
  defineGame,
  resource,
  system,
  Transform,
  tag,
  type
} from "../../../../index";
import { stepFrames } from "../../../flow/headless";
import { rendererPlugin } from "../../../renderer";
import { worldPlugin } from "../../../world";
import { projection } from "../../../world/projection/define";
import { AnimPlayer } from "../../components";
import { animPlugin } from "../../index";
import { defineAnimation, tween } from "../../timeline/steps";
import type { PlayHandle, Target } from "../../types";

// ---------------------------------------------------------------------------
// Integration: the real time, world, renderer and anim plugins. A system starts a chest's endless
// bounce once through `AnimPlayer` (F75), keeps its handle and cancels it when the chest is no
// longer ready (F74), and the endless track lets the clock idle like a view's loop (F76).
// ---------------------------------------------------------------------------

type Chest = { id: string; x: number };
type Player = { chests: Chest[] };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** The chest bounce of the README recipe: one hop of 14 up, then a pause, every 2.4 s. */
const chestBounce = defineAnimation("board.chestBounce", {
  slots: { chest: type<Target>() },
  build: ({ chest }) =>
    tween(
      chest,
      Transform,
      { y: 0, scale: 0 },
      {
        ms: 2400,
        additive: true,
        repeat: "forever",
        segments: [
          { at: 0.08, ease: "out", to: { y: -14, scale: 0.06 } },
          { at: 0.16, ease: "in", to: { y: 0, scale: -0.03 } },
          { at: 0.22, ease: "out", to: { y: 0, scale: 0 } },
          { at: 1, to: { y: 0, scale: 0 } }
        ]
      }
    )
});

const ChestItem = component("ChestItem", { id: "" });
const Ready = tag("Ready");

/** Per-system state: the handle of every bounce that plays. */
const Bounces = resource("chestBounces", () => new Map<World.Entity, PlayHandle>());

const bounceChests = system({
  name: "bounceChests",
  phase: "input",
  query: [ChestItem],
  run: (rows, { world, res }) => {
    const handles = res(Bounces);

    for (const [entity] of rows) {
      const ready = world.has(entity, Ready);
      const handle = handles.get(entity);

      if (ready && handle === undefined) {
        handles.set(entity, res(AnimPlayer).play(chestBounce, { chest: entity }));
      }

      if (!ready && handle !== undefined) {
        handle.cancel();
        handles.delete(entity);
      }
    }
  }
});

const chests = projection({
  name: "board.chests",
  layer: "items",
  from: (player: Player) => player.chests,
  key: (chest: Chest) => chest.id,
  view: (chest: Chest) => [
    ChestItem({ id: chest.id }),
    Transform({ x: chest.x, y: 300, rotation: 0, scale: 1 })
  ]
});

const home = defineNode({ outcomes: { go: type() }, rest: true });
const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  edges: { home: { go: "home" } }
});
const boardFeature = defineFeature("board", {
  flows: [main],
  components: [ChestItem],
  systems: [bounceChests],
  projections: [chests],
  animations: [chestBounce]
});

/**
 * Starts the board app and answers the view of the one chest.
 *
 * @returns The started app and the chest.
 */
async function startBoard() {
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, boardFeature],
    pluginConfigs: {
      model: { initialPlayer: { chests: [{ id: "c1", x: 40 }] }, seed: 1 },
      flow: { mainFlow: main }
    }
  });

  await app.start();
  app.world.projection.setLayers([{ name: "items", sort: "none" }]);
  app.world.projection.mount(["board.chests"], { kind: "plugin", name: "test" });

  const chest = app.world.projection.entityOf("board.chests", "c1");

  if (chest === undefined) throw new Error("the board drew no chest");

  return { app, chest };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a system's endless bounce through AnimPlayer", () => {
  it("bounces from one play, and its handle's cancel puts the chest back and stops every write", async () => {
    const { app, chest } = await startBoard();
    const pose = () => app.world.ecs.get(chest, Transform);

    app.world.ecs.tag(chest, Ready);
    // 12 frames of 16 ms: 192 ms, the top of the hop at 0.08 of 2.4 s.
    stepFrames(app, 12, 16);

    expect(pose()?.y).toBeCloseTo(286, 6);
    expect(pose()?.scale).toBeCloseTo(1.06, 6);
    expect(app.world.ecs.resource(Bounces).size).toBe(1);

    // Three cycles later the same play still bounces: nothing started it again.
    stepFrames(app, 450, 16);

    expect(app.world.ecs.resource(Bounces).get(chest)?.active()).toBe(true);
    expect(app.anim.active()).toBe(1);

    app.world.ecs.untag(chest, Ready);
    stepFrames(app, 1, 16);

    expect(pose()).toMatchObject({ y: 300, scale: 1 });
    expect(app.anim.active()).toBe(0);

    stepFrames(app, 30, 16);

    expect(pose()).toMatchObject({ y: 300, scale: 1 });

    await app.stop();
  });

  it("lets the clock drop to its idle rate two seconds after the play, while the chest bounces on", async () => {
    let pending: FrameRequestCallback | undefined;

    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pending = callback;

      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { app, chest } = await startBoard();
    const heights = new Set<number>();
    let idleAt = Number.NaN;

    app.world.ecs.tag(chest, Ready);

    // 60 Hz for 3.5 s: the bounce plays at once, its second hop starts at 2.4 s.
    for (let at = 1000 / 60; at < 3500; at += 1000 / 60) {
      const callback = pending;

      pending = undefined;
      callback?.(at);

      if (Number.isNaN(idleAt) && app.time.snapshot().idle) idleAt = at;
      if (!Number.isNaN(idleAt)) heights.add(app.world.ecs.get(chest, Transform)?.y ?? 0);
    }

    expect(idleAt).toBeGreaterThan(2000);
    expect(idleAt).toBeLessThan(2100);
    // The second run woke nothing: the clock is still idle a second after it began.
    expect(app.time.snapshot().idle).toBe(true);
    // Idle, the bounce still walks: its second hop moved the chest.
    expect(heights.size).toBeGreaterThan(1);

    await app.stop();
  });
});
