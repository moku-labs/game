/**
 * @file Root integration — a view built in the same `sync` pass as its parent hangs under that parent, whatever order
 * the pass met them in (spec 16 U2.3, H1). Two ways a child waits before its parent: a hook of a projection root's own
 * component spawns it while the root is spawned (`Layer` comes first since 85fba19, so "the root is whole" already
 * holds), and a parent that gets its visual after its child. The child must be in the tree in the first frame, hit by
 * `sync.hitTest`, and "renderer: parent draws nothing" must never be logged. The tree oracle checks every frame.
 */
import type { Assets, World } from "@moku-labs/game";
import {
  component,
  createPlugin,
  defineGame,
  Layer,
  Order,
  Parent,
  Shape,
  system,
  Touchable,
  Transform,
  type,
  worldPlugin
} from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openPage, type Watched, watch } from "./drawn-helpers";

/** What the test reads of a display object. */
type Shown = { label: string; parent: Shown | null };

/** The root a plugin adopts, as a game's camera adopts its `Pan` root. */
const Room = component("parentFirst.room", { w: 300, h: 300 });

/** The owner of what the tests spawn. */
const OWNER = { kind: "plugin", name: "parentFirst" } as const;

/** The adopted root and its touch surface. */
const adopted = { root: 0, surface: 0 };

/**
 * Spawns the invisible touch surface under the root once the root has its layer.
 *
 * @param ecs - The ecs of the app.
 * @param root - The root.
 */
function keepSurface(ecs: World.Api["ecs"], root: World.Entity): void {
  const layer = ecs.get(root, Layer);

  if (adopted.surface !== 0 || layer === undefined) return;

  adopted.surface = ecs.spawn(OWNER, [
    Parent({ entity: root }),
    Transform({ x: 0, y: 0 }),
    Shape({ kind: "rect", w: 300, h: 300, fill: 0xff_ff_ff, fillAlpha: 0 }),
    Order({ value: 100_000 }),
    Touchable(),
    Layer({ name: layer.name })
  ]);
}

/** Adopts a `Room` root in its `onAdded`, in the middle of the root's spawn, and keeps its surface. */
const roomHostPlugin = createPlugin("roomHost", {
  depends: [worldPlugin],
  onStart: ctx => {
    const { ecs } = ctx.require(worldPlugin);

    ecs.onAdded(Room, root => {
      adopted.root = root;
      adopted.surface = 0;
      keepSurface(ecs, root);
    });
    ecs.onRemoved(Room, () => {
      if (adopted.surface !== 0) ecs.despawn(adopted.surface);
      adopted.root = 0;
      adopted.surface = 0;
    });
    ecs.system(
      system({
        name: "parentFirst.surface",
        phase: "layout",
        query: [],
        run: () => {
          if (adopted.root !== 0) keepSurface(ecs, adopted.root);
        }
      })
    );
  }
});

const { defineNode, defineFlow, defineFeature, defineScene, projection } = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  scenes: "main" | "other";
  strings: Record<string, never>;
}>();

const room = projection({
  name: "parentFirst.room",
  layer: "scene",
  from: () => ({ id: "room" }),
  view: () => [Room({ w: 300, h: 300 }), Shape({ kind: "rect", w: 300, h: 300, fill: 0x9f_b7_b4 })]
});

const hub = defineNode({
  scene: "main",
  outcomes: { leave: type() },
  rest: true,
  checkpoint: true
});
const away = defineNode({ scene: "other", outcomes: { back: type() }, rest: true });
const flow = defineFlow("main", {
  nodes: { hub, away },
  start: "hub",
  edges: { hub: { leave: "away" }, away: { back: "hub" } }
});

const manifest: Assets.Manifest = {
  version: 1,
  bundles: { parentFirst: { feature: "parentFirst", tier: "scene", mb: 0, files: [] } }
};

const main = defineScene("main", {
  bundle: "parentFirst",
  layers: { scene: { sort: "order" } },
  projections: [room]
});
const other = defineScene("other", { bundle: "parentFirst", layers: {}, projections: [] });
const parentFirstFeature = defineFeature("parentFirst", {
  scenes: [main, other],
  projections: [room]
});

/** The running apps, stopped by `afterEach` after the oracle's last word. */
const running: Array<{ stop(): Promise<void>; watched: Watched }> = [];

afterEach(async () => {
  for (const { stop, watched } of running.splice(0)) {
    watched.oracle.expectNoMissedFrame();
    await stop();
  }

  vi.unstubAllGlobals();
});

/**
 * Starts the fixture on a page at `hub`, before its first frame.
 *
 * @returns The app, its frame driver and what the test reads of it.
 */
async function open() {
  adopted.root = 0;
  adopted.surface = 0;

  const page = openPage();
  const { app } = defineGameApp({
    flow,
    safeNode: "hub",
    player: { n: 0 },
    session: {},
    referenceSide: 390,
    features: [parentFirstFeature],
    plugins: [roomHostPlugin],
    pluginConfigs: { log: { mode: "test" } }
  }).screen({ manifest, renderer: page.renderer });

  await app.start();
  app.flow.run().catch(() => undefined);

  const watched = watch(app, page);

  running.push({ stop: () => app.stop(), watched });

  return {
    app,
    watched,
    hangsIn: (entity: World.Entity) =>
      (app.renderer.sync.displayOf(entity) as Shown | undefined)?.parent?.label,
    orphaned: () =>
      app.log.trace().filter(entry => entry.event === "renderer: parent draws nothing").length
  };
}

/**
 * Waits until the graph rests at a node with its gate open.
 *
 * @param app - The app.
 * @param app.flow - Its flow.
 * @param app.flow.state - Where the graph is.
 * @param app.flow.gate - Its gate.
 * @param app.flow.gate.state - Whether the gate is open.
 * @param path - The path of the rest node.
 */
async function arrive(
  app: { flow: { state(): { path: string }; gate: { state(): { open: boolean } } } },
  path: string
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (app.flow.state().path === path && app.flow.gate.state().open) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  throw new Error(`The flow did not rest at "${path}".`);
}

describe("a view built in the same pass as its parent, before it", () => {
  // Bug (85fba19): the hook of the root's own component spawns the surface while the root is spawned, so the surface
  // waits first in the pass, is built before its root, and is left out of the tree for good: never drawn, never hit.
  it.each([
    "start",
    "entry"
  ])("hangs under the root that spawned it in its hook, in the first frame, and is hit (%s)", async way => {
    const fixture = await open();

    if (way === "entry") {
      await fixture.watched.frames(1);
      fixture.app.flow.gate.answer({ intent: "leave" });
      await arrive(fixture.app, "away");
      await fixture.watched.frames(1);
      fixture.app.flow.gate.answer({ intent: "back" });
      await arrive(fixture.app, "hub");
    }

    await fixture.watched.frames(1);

    const { root, surface } = adopted;
    const hit = fixture.app.renderer.sync.hitTest(150, 150, entity => entity === surface);

    expect({ surface: fixture.hangsIn(surface), hit, orphaned: fixture.orphaned() }).toEqual({
      surface: `parent#${root}`,
      hit: surface,
      orphaned: 0
    });
  });

  // Bug (H1, every commit before the fix): a parent whose visual comes after its child's is built second in the pass.
  it("hangs under a parent that got its visual after it", async () => {
    const fixture = await open();
    const { ecs } = fixture.app.world;

    await fixture.watched.frames(1);

    const parent = ecs.spawn(OWNER, []);
    const child = ecs.spawn(OWNER, [
      Parent({ entity: parent }),
      Shape({ kind: "rect", w: 40, h: 40, fill: 0xff_00_00 }),
      Layer({ name: "scene" })
    ]);

    ecs.add(parent, Layer({ name: "scene" }));
    ecs.add(parent, Shape({ kind: "rect", w: 100, h: 100, fill: 0x00_ff_00 }));
    await fixture.watched.frames(1);

    expect({ child: fixture.hangsIn(child), orphaned: fixture.orphaned() }).toEqual({
      child: `parent#${parent}`,
      orphaned: 0
    });
  });
});
