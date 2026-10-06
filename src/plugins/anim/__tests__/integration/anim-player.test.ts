import { describe, expect, it, vi } from "vitest";
import type { World } from "../../../../index";
import {
  component,
  createApp,
  defineGame,
  PointerOver,
  Pressed,
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
// Integration: a plain system of a feature plays animations through the
// `AnimPlayer` resource. The hover look of merge-game, without a plugin: its
// per-system state is a resource too, made by a factory.
// ---------------------------------------------------------------------------

/** The sentence a system gets when it plays before `anim` started. */
const NOT_READY =
  "[game] AnimPlayer is not ready: anim has not started.\n" +
  "  Add animPlugin to the app before a system plays an animation.";

type Item = { id: string; x: number };
type Player = { items: Item[] };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, unknown>;
}>();

/**
 * Builds a look: one 100 ms linear tween of the scale.
 *
 * @param id - Animation id.
 * @param scale - The scale the look lands on.
 * @returns The animation.
 */
function lookOf(id: string, scale: number) {
  return defineAnimation(id, {
    slots: { thing: type<Target>() },
    build: ({ thing }) => tween(thing, Transform, { scale }, { ms: 100, ease: "linear" })
  });
}

const lift = lookOf("look.hover", 1.1);
const squash = lookOf("look.pressed", 0.9);
const rest = lookOf("look.rest", 1);
const pop = lookOf("look.pop", 1.2);
const looks = { hover: lift, pressed: squash, rest } as const;

type Look = keyof typeof looks;
type Shown = { look: Look; handle?: PlayHandle };

const BoardItem = component("BoardItem", { id: "" });
const Fresh = tag("Fresh");

/** Per-system state: what every view shows and every look played. One per world. */
const Looks = resource("boardLooks", () => ({
  shown: new Map<World.Entity, Shown>(),
  played: [] as Array<{ frame: number; look: Look }>
}));

/**
 * Reads the look an item should show now.
 *
 * @param world - The ecs of the world.
 * @param entity - The item.
 * @returns The wanted look.
 */
function wantedLook(world: World.EcsApi, entity: World.Entity): Look {
  if (world.has(entity, Pressed)) return "pressed";

  return world.has(entity, PointerOver) ? "hover" : "rest";
}

const hoverLook = system({
  name: "hoverLook",
  phase: "input",
  query: [BoardItem],
  run: (items, { world, res, time }) => {
    const player = res(AnimPlayer);
    const { shown, played } = res(Looks);

    for (const [entity] of items) {
      const wanted = wantedLook(world, entity);
      const before = shown.get(entity) ?? { look: "rest" };

      if (wanted === before.look) continue;

      before.handle?.cancel();
      shown.set(entity, { look: wanted, handle: player.play(looks[wanted], { thing: entity }) });
      played.push({ frame: time.frame, look: wanted });
    }
  }
});

// The example of `Anim.AnimPlayerValue`: a fresh item pops once, then loses its tag.
const popIn = system({
  name: "popIn",
  phase: "input",
  query: [Fresh],
  run: (items, { world, res }) => {
    for (const [entity] of items) {
      res(AnimPlayer).play(pop, { thing: entity });
      world.untag(entity, Fresh);
    }
  }
});

const boardItems = projection({
  name: "board.items",
  layer: "items",
  from: (player: Player) => player.items,
  key: (item: Item) => item.id,
  view: (item: Item) => [
    BoardItem({ id: item.id }),
    Transform({ x: item.x, y: 0, rotation: 0, scale: 1 })
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
  components: [BoardItem],
  systems: [hoverLook, popIn],
  projections: [boardItems],
  animations: [lift, squash, rest, pop]
});

const pluginConfigs = {
  model: {
    initialPlayer: {
      items: [
        { id: "a", x: 10 },
        { id: "b", x: 20 }
      ]
    },
    seed: 1
  },
  flow: { mainFlow: main }
};

/**
 * Creates the board app: world, renderer, anim and the board feature. Not started.
 *
 * @returns The app.
 */
function createBoard() {
  return createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, boardFeature],
    pluginConfigs
  });
}

/**
 * Starts the board app, mounts the items and answers the views of items "a" and "b".
 *
 * @returns The started app and the two view entities.
 */
async function startBoard() {
  const app = createBoard();

  await app.start();
  app.world.projection.setLayers([{ name: "items", sort: "none" }]);
  app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });

  const a = app.world.projection.entityOf("board.items", "a");
  const b = app.world.projection.entityOf("board.items", "b");

  if (a === undefined || b === undefined) throw new Error("the board drew no items");

  return { app, a, b };
}

/**
 * Hovers item "a", presses it and lets it go, and answers the scale after each step.
 *
 * @param app - The started board app.
 * @param a - The view of item "a".
 * @returns The scale of item "a" after hover, press and release.
 */
function hoverPressRelease(app: ReturnType<typeof createBoard>, a: World.Entity): number[] {
  const scales: number[] = [];
  const scale = (): number => app.world.ecs.get(a, Transform)?.scale ?? Number.NaN;

  app.world.ecs.tag(a, PointerOver);
  stepFrames(app, 7, 16);
  scales.push(scale());

  app.world.ecs.tag(a, Pressed);
  stepFrames(app, 7, 16);
  scales.push(scale());

  app.world.ecs.untag(a, Pressed);
  app.world.ecs.untag(a, PointerOver);
  stepFrames(app, 7, 16);
  scales.push(scale());

  return scales;
}

describe("AnimPlayer: a system plays animations", () => {
  it("plays from a plain system on the first tick; the track advances in the same frame", async () => {
    const { app, a } = await startBoard();

    app.world.ecs.tag(a, PointerOver);
    stepFrames(app, 1, 16);

    expect(app.world.ecs.resource(Looks).played).toEqual([{ frame: 1, look: "hover" }]);
    expect(app.anim.active()).toBe(1);
    expect(app.world.ecs.get(a, Transform)?.scale).toBeCloseTo(1.016);

    await app.stop();
  });

  it("hands out the handle: active until the 100 ms tween lands, then the screen rests", async () => {
    const { app, a } = await startBoard();

    app.world.ecs.tag(a, PointerOver);
    stepFrames(app, 1, 16);

    const handle = app.world.ecs.resource(Looks).shown.get(a)?.handle;

    expect(a).toBe(1_048_576);
    expect(handle?.active()).toBe(true);

    stepFrames(app, 6, 16);

    expect(handle?.active()).toBe(false);
    expect(app.anim.active()).toBe(0);
    expect(app.world.ecs.get(a, Transform)?.scale).toBe(1.1);

    await app.stop();
  });

  it("walks the looks on change only: hover, press, release", async () => {
    const { app, a } = await startBoard();

    expect(hoverPressRelease(app, a)).toEqual([1.1, 0.9, 1]);
    expect(app.world.ecs.resource(Looks).played.map(entry => entry.look)).toEqual([
      "hover",
      "pressed",
      "rest"
    ]);
    expect(app.anim.active()).toBe(0);

    await app.stop();
  });

  it("plays once from a system that takes its tag away", async () => {
    const { app, b } = await startBoard();

    app.world.ecs.tag(b, Fresh);
    stepFrames(app, 1, 16);

    expect(app.world.ecs.has(b, Fresh)).toBe(false);
    expect(app.anim.active()).toBe(1);

    stepFrames(app, 7, 16);

    expect(app.world.ecs.get(b, Transform)?.scale).toBe(1.2);
    expect(app.anim.active()).toBe(0);

    await app.stop();
  });

  it("gives two apps that take the same steps the same world", async () => {
    const first = await startBoard();
    const second = await startBoard();

    hoverPressRelease(first.app, first.a);
    hoverPressRelease(second.app, second.a);

    expect(first.app.world.ecs.snapshot()).toEqual(second.app.world.ecs.snapshot());

    await first.app.stop();
    await second.app.stop();
  });

  it("throws the sentence before anim starts, and plays on the same object after", async () => {
    const app = createBoard();
    const player = app.world.ecs.resource(AnimPlayer);

    expect(() => player.play(lift, { thing: 1_048_576 })).toThrow(NOT_READY);

    await app.start();
    app.world.projection.setLayers([{ name: "items", sort: "none" }]);
    app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });

    expect(app.world.ecs.resource(AnimPlayer)).toBe(player);
    expect(app.world.ecs.resource(AnimPlayer).play(lift, { thing: 1_048_576 }).active()).toBe(true);

    await app.stop();
  });

  it("is the default again after stop: the world dropped the resource", async () => {
    const { app, a } = await startBoard();

    await app.stop();

    expect(() => app.world.ecs.resource(AnimPlayer).play(lift, { thing: a })).toThrow(NOT_READY);
  });

  it("plays the hot-replaced definition from a system; app.anim.play keeps what it is given", async () => {
    const { app, a, b } = await startBoard();

    app.anim.replace(lookOf("look.hover", 1.3));
    app.world.ecs.tag(a, PointerOver);
    app.anim.play(lift, { thing: b });
    stepFrames(app, 7, 16);

    expect(app.world.ecs.get(a, Transform)?.scale).toBe(1.3);
    expect(app.world.ecs.get(b, Transform)?.scale).toBe(1.1);

    await app.stop();
  });

  it("logs the sentence as world:system-failed when the app has no anim", async () => {
    const print = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({ plugins: [worldPlugin, boardFeature], pluginConfigs });

    await app.start();
    app.world.projection.setLayers([{ name: "items", sort: "none" }]);
    app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });

    const a = app.world.projection.entityOf("board.items", "a");

    if (a !== undefined) app.world.ecs.tag(a, PointerOver);
    stepFrames(app, 1, 16);

    const failed = app.log.trace().find(entry => entry.event === "world:system-failed");

    expect(failed?.data).toMatchObject({
      system: "hoverLook",
      phase: "input",
      error: { message: NOT_READY }
    });

    await app.stop();
    print.mockRestore();
  });
});
