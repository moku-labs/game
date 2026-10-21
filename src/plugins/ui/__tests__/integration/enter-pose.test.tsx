/**
 * @file ui plugin — a game system of phase `sync` sees an element's enter start pose in the frame the element came
 * (F49, A Memory Missing's memory window). The game's gate reads the scale of a new picture in `sync` to switch its
 * own work on; the hook starts the picture at scale 0. Since the hooks play after the game's systems (F48), the gate
 * saw the rest scale 1 in that frame while the frame drew the picture at 0. The hook still starts where the game's
 * other system of `sync` moved it (F48). A small game on the fake page, every frame read after it is stepped.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  component,
  createApp,
  defineComponent,
  defineGame,
  defineScene,
  projection,
  screen,
  system,
  Transform,
  type
} from "../../../../index";
import type { Manifest } from "../../../assets/types";
import type { CompiledMessages } from "../../../i18n/types";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { createFakePixi, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import type { ViewHandle } from "../../../world/projection/types";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: { "pose.title": Record<string, never> };
}>();

/** The one scene bundle, with no files to fetch. */
const manifest: Manifest = {
  version: 2,
  bundles: { window: { feature: "pose", tier: "lazy", mb: 0, files: [] } }
};

/** The one compiled locale. */
const english: CompiledMessages = { "pose.title": () => [{ kind: "text", text: "pose" }] };

/** How far below its rest the picture starts, before the game's system moved it. */
const START_DY = 300;

/** How far the game's system moves the start, in the picture's first frame. */
const MOVED_DY = -120;

/** Where the picture starts, relative to its rest, and whether the game's system moved it yet. */
const StartFrom = component("StartFrom", { dy: START_DY, moved: false });

/** The scales the game's gate saw, one per frame it saw the picture. */
const seen: number[] = [];

/** The game's system that moves the start of a new picture, once (registered first: it runs before the gate). */
const moveStart = system({
  name: "pose.move",
  phase: "sync",
  query: [StartFrom],
  run: (rows, { world }) => {
    for (const [entity, from] of rows) {
      if (!from.moved) world.set(entity, StartFrom, { dy: from.dy + MOVED_DY, moved: true });
    }
  }
});

/** The game's gate: reads the scale of the picture every frame, as A Memory Missing's alpha gate reads an alpha. */
const gate = system({
  name: "pose.gate",
  phase: "sync",
  query: [StartFrom, Transform],
  run: rows => {
    for (const row of rows) seen.push(row[2].scale);
  }
});

/** How often the enter hook ran with each start it read. */
const hookStarts: number[] = [];

/** Whether the hook starts from the pose it finds rather than from the rest, set by a test. */
const hookOf = { relative: false };

/**
 * The picture's enter hook: it starts at scale 0, moved by `StartFrom.dy`, and travels to its rest.
 *
 * @param view - The picture.
 * @returns The track to the rest.
 */
function poseEnter(view: ViewHandle<unknown>) {
  const from = hookOf.relative ? view.get(Transform)?.y : view.rest(Transform)?.y;
  const dy = view.get(StartFrom)?.dy ?? 0;

  hookStarts.push(dy);
  view.set(Transform, { y: (from ?? 0) + dy, scale: 0 });

  return view.toRest(Transform, { ms: 300 });
}

/** The window: a button that opens the picture, and the picture. */
const Window = defineComponent("Window", {
  local: { open: false },
  view: (_props: object, local) => (
    <column key="windowRoot" style={{ width: 1080, height: 1920 }}>
      <button key="open" local={{ open: true }} style={{ width: 100, height: 100 }} />
      {local.open ? (
        <stack
          key="picture"
          motion={{ enter: poseEnter }}
          components={[StartFrom()]}
          style={{ width: 200, height: 200, fill: 0x88_44_22 }}
        />
      ) : undefined}
    </column>
  )
});

/** The window's root, a JSX root in layer `scene`. */
const windowRoot = projection({
  name: "pose.window",
  layer: "scene",
  from: () => ({ id: "window" }),
  view: () => <Window />
});

const windowScene = defineScene("window", {
  bundle: "window",
  layers: { scene: {} },
  projections: [windowRoot]
});
const rest = defineNode({ rest: true, scene: "window", outcomes: { again: type() } });
const main = defineFlow("main", {
  nodes: { rest },
  start: "rest",
  outcomes: {},
  edges: { rest: { again: "rest" } }
});
const feature = defineFeature("pose", {
  flows: [main],
  scenes: [windowScene],
  projections: [windowRoot],
  components: [StartFrom],
  systems: [moveStart, gate],
  ui: [Window],
  strings: { en: english }
});

const running: Array<{ stop(): Promise<void> }> = [];

/**
 * Starts the game on the window.
 *
 * @returns The running app and the frame driver.
 */
async function startWindow() {
  installFakeDom({ width: 1080, height: 1920 });
  seen.length = 0;
  hookStarts.length = 0;

  const pixi = createFakePixi();
  const app = createApp({
    plugins: [...screen, feature],
    pluginConfigs: {
      assets: { manifest },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module), warm: 0 }
    }
  });

  await app.start();
  running.push(app);
  app.renderer.sync.textures.provide(() => new FakeTexture({}) as never);
  app.flow.run().catch(() => undefined);

  /**
   * Steps frames of 16 ms, the runner given its turn before each, and reads each.
   *
   * @param count - How many.
   * @param each - What runs after each frame.
   */
  const frames = async (count: number, each?: () => void): Promise<void> => {
    for (let frame = 1; frame <= count; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      app.time.step(16);
      each?.();
    }
  };

  await frames(8);

  return { app, frames };
}

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  hookOf.relative = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("an enter start pose seen by the game's systems (F49)", () => {
  // Bug (A Memory Missing, memory window): the gate saw the rest pose in the picture's first frame, the hook wrote the
  // start pose after it, and the frame was drawn so with the gate's work off: the window flashed for one frame.
  it("shows the gate the start pose in the first frame, and still starts where the other system moved it", async () => {
    const game = await startWindow();
    const { app } = game;

    app.input.tap(app.ui.find("open") ?? 0);

    const firsts: Array<{ y: number; scale: number; drawnScale: number }> = [];

    await game.frames(4, () => {
      const picture = app.ui.find("picture");
      const display = picture === undefined ? undefined : app.renderer.sync.displayOf(picture);

      if (picture === undefined || display === undefined || firsts.length > 0) return;

      const transform = app.world.ecs.get(picture, Transform);

      firsts.push({
        y: transform?.y ?? Number.NaN,
        scale: transform?.scale ?? Number.NaN,
        drawnScale: (display as { scale: { x: number } }).scale.x
      });
    });

    // The track is over: the picture stands at its rest.
    await game.frames(30);

    const picture = app.ui.find("picture") ?? 0;
    const restY = app.world.ecs.get(picture, Transform)?.y ?? Number.NaN;
    const start = firsts[0];

    // The gate's first look is the start pose, never the rest pose the frame does not draw.
    expect(seen[0]).toBe(0);
    expect(start?.scale).toBe(0);
    expect(start?.drawnScale).toBe(0);
    // F48 holds: the hook that drives the motion read the start the game's system moved.
    expect(hookStarts.at(-1)).toBe(START_DY + MOVED_DY);
    expect(start?.y).toBeCloseTo(restY + START_DY + MOVED_DY, 0);
    expect(seen.at(-1)).toBe(1);
  });

  // The hook that plays again finds the pose as it was before its first play, not the start that play wrote: a hook
  // that starts from the pose it finds starts once from the rest, not twice moved.
  it("plays the hook again from the pose before its first play", async () => {
    hookOf.relative = true;

    const game = await startWindow();
    const { app } = game;

    app.input.tap(app.ui.find("open") ?? 0);

    const firstY: number[] = [];

    await game.frames(4, () => {
      const picture = app.ui.find("picture");

      if (picture === undefined || app.renderer.sync.displayOf(picture) === undefined) return;
      if (firstY.length === 0) firstY.push(app.world.ecs.get(picture, Transform)?.y ?? Number.NaN);
    });
    await game.frames(30);

    const restY = app.world.ecs.get(app.ui.find("picture") ?? 0, Transform)?.y ?? Number.NaN;

    expect(hookStarts).toEqual([START_DY, START_DY + MOVED_DY]);
    expect(firstY[0]).toBeCloseTo(restY + START_DY + MOVED_DY, 0);
  });
});
