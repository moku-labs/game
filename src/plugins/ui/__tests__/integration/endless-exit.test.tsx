/**
 * @file ui plugin — a leaving element and its endless motions (F42, A Memory Missing's board row). A
 * `change` hook of an extra component that starts a `repeat: "forever"` track, as the ward button's hot pulse
 * does, never ends by itself: the exit must not wait for it, or the root is drawn over the next scene for
 * the life of the page. A restore drops every root that is still leaving, as a page reload does. A small game
 * on the fake page: the ward's root holds the hot button, the button that heats it and a door; the board is
 * another scene.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  component,
  createApp,
  defineComponent,
  defineGame,
  defineMotion,
  defineScene,
  projection,
  screen,
  Transform,
  type
} from "../../../../index";
import type { Manifest } from "../../../assets/types";
import type { CompiledMessages } from "../../../i18n/types";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { createFakePixi, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import type { Motion, ViewHandle } from "../../../world/types";
import type { ElementMotion } from "../../jsx/types";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: { "endless.title": Record<string, never> };
}>();

/** The two scene bundles, with no files to fetch. */
const manifest: Manifest = {
  version: 2,
  bundles: {
    ward: { feature: "endless", tier: "lazy", mb: 0, files: [] },
    board: { feature: "endless", tier: "lazy", mb: 0, files: [] }
  }
};

/** The one compiled locale. */
const english: CompiledMessages = { "endless.title": () => [{ kind: "text", text: "endless" }] };

/** The game's own component the hot pulse follows, as `BoardWardHot` is. */
const Hot = component("Hot", { on: 0 });

/**
 * The `change.Hot` hook of the ward button: a pulse that repeats forever while the button is hot.
 *
 * @param view - The handle of the button.
 * @returns The pulse.
 */
function pulse(view: ViewHandle<unknown>): Motion {
  return view.tween(Transform, { scale: 1.1 }, { ms: 300, repeat: "forever" });
}

/** The ward button's motion: the hot pulse on a change of `Hot`. */
const hotMotion: ElementMotion = { change: { Hot: pulse } };

/** The ward's root grows for 160 ms before it goes, as A Memory Missing's does. */
const leave = defineMotion({
  states: { gone: { Transform: { scale: 1.05 } } },
  transition: { ms: 160 },
  on: { exit: "gone" }
});

/** A slow exit, still running when a restore comes: 5 s. */
const slowLeave = defineMotion({
  states: { gone: { Transform: { scale: 1.05 } } },
  transition: { ms: 5000 },
  on: { exit: "gone" }
});

/**
 * An exit a world restore cannot end: its motion is a handle of the game's own, a wait on a timer as a game's
 * timeline would be, active until it is finished or cancelled.
 */
const heldLeave: ElementMotion = {
  exit: (): Motion => {
    let active = true;

    return {
      finish: () => {
        active = false;
      },
      cancel: () => {
        active = false;
      },
      active: () => active
    };
  }
};

/** Which exit the ward's root plays, set by a test. */
const exitOf = { slow: false, held: false };

/**
 * The motion of the ward's root: the held exit, the slow one or the usual one.
 *
 * @returns The motion prop.
 */
function rootMotion(): ElementMotion | typeof leave {
  if (exitOf.held) return heldLeave;

  return exitOf.slow ? slowLeave : leave;
}

/** The ward's screen: the hot button, the button that heats it, and the door to the board. */
const Ward = defineComponent("Ward", {
  local: { hot: 0 },
  view: (_props: object, local) => (
    <stack key="wardRoot" motion={rootMotion()} style={{ width: 1080, height: 1920 }}>
      <button
        key="wardButton"
        motion={hotMotion}
        components={[Hot({ on: local.hot })]}
        style={{ width: 200, height: 200, fill: 0x22_22_22 }}
      />
      <button key="heat" local={{ hot: 1 }} style={{ width: 200, height: 200 }} />
      <button key="door" intent="board" style={{ width: 200, height: 200 }} />
    </stack>
  )
});

/** The ward's root, a JSX root in layer `scene`. */
const wardRoot = projection({
  name: "endless.ward",
  layer: "scene",
  from: () => ({ id: "ward" }),
  view: () => <Ward />
});

/** The board's root, in a layer of its own. */
const boardRoot = projection({
  name: "endless.board",
  layer: "cells",
  from: () => ({ id: "board" }),
  view: () => <stack key="boardRoot" style={{ width: 1080, height: 1920 }} />
});

const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { scene: {} },
  projections: [wardRoot]
});
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [boardRoot]
});
const ward = defineNode({ rest: true, scene: "ward", outcomes: { board: type() } });
const board = defineNode({ rest: true, scene: "board", outcomes: { back: type() } });
const main = defineFlow("main", {
  nodes: { ward, board },
  start: "ward",
  outcomes: {},
  edges: { ward: { board: "board" }, board: { back: "ward" } }
});
const feature = defineFeature("endless", {
  flows: [main],
  scenes: [wardScene, boardScene],
  projections: [wardRoot, boardRoot],
  ui: [Ward],
  strings: { en: english }
});

/** Frames of the ward's whole 160 ms exit and more: 30 × 16 ms. */
const SETTLED = 30;

const running: Array<{ stop(): Promise<void> }> = [];

/**
 * Starts the game on the ward in a dev build, every warning kept.
 *
 * @returns The running app, the frame driver, the reader of the kept warnings and whether an entity is drawn.
 */
async function startWard() {
  const warned: Array<{ event: string; data: unknown }> = [];

  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  vi.spyOn(console, "warn").mockImplementation((entry: { event: string; data: unknown }) => {
    warned.push(entry);
  });
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakePixi();
  const app = createApp({
    plugins: [...screen, feature],
    pluginConfigs: {
      assets: { manifest },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module) }
    }
  });

  await app.start();
  running.push(app);
  app.renderer.sync.textures.provide(() => new FakeTexture({}) as never);
  app.flow.run().catch(() => undefined);

  /**
   * Steps frames of 16 ms, the runner given its turn before each.
   *
   * @param count - How many.
   */
  const frames = async (count: number): Promise<void> => {
    for (let frame = 1; frame <= count; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      app.time.step(16);
    }
  };

  await frames(6);

  return {
    app,
    frames,
    warnings: (event: string): unknown[] =>
      warned.filter(entry => entry.event === event).map(entry => entry.data),
    drawn: (entity: number): boolean => app.renderer.sync.displayOf(entity) !== undefined
  };
}

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  exitOf.slow = false;
  exitOf.held = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a leaving root with an endless motion (F42)", () => {
  // Bug (A Memory Missing, board row): the hot pulse's handle was copied into the exit's handles, the sweep
  // waited for it forever, and the root was drawn over the next scene for the life of the page.
  it("goes with its scene although its hot button pulses forever, and warns once in a dev build", async () => {
    const game = await startWard();
    const { app } = game;
    const root = app.ui.find("wardRoot") ?? 0;
    const button = app.ui.find("wardButton") ?? 0;

    app.input.tap(app.ui.find("heat") ?? 0);
    await game.frames(4);
    app.input.tap(app.ui.find("door") ?? 0);
    await game.frames(SETTLED);

    expect(app.flow.state().path).toBe("board");
    expect(game.drawn(button)).toBe(false);
    expect(game.drawn(root)).toBe(false);
    expect(game.warnings("ui:exit-waits-forever")).toEqual([{ key: "wardButton" }]);
  });

  // The other side: a finite exit is still waited for, so the root stays drawn while it plays.
  it("still waits for a finite exit: the root is drawn while it plays", async () => {
    exitOf.slow = true;

    const game = await startWard();
    const { app } = game;
    const root = app.ui.find("wardRoot") ?? 0;

    app.input.tap(app.ui.find("door") ?? 0);
    await game.frames(SETTLED);

    expect(app.flow.state().path).toBe("board");
    expect(game.drawn(root)).toBe(true);
  });

  // Bug: a restore rebuilt the roots of the restored state and left a root that was still leaving on the
  // screen, so only a page reload cleared it.
  it("drops a root that is still leaving when a restore comes", async () => {
    exitOf.slow = true;

    const game = await startWard();
    const { app } = game;
    const root = app.ui.find("wardRoot") ?? 0;

    app.input.tap(app.ui.find("door") ?? 0);
    await game.frames(10);

    expect(app.flow.state().path).toBe("board");
    expect(game.drawn(root)).toBe(true);

    const restored = app.flow.restore(app.flow.bookmark());

    await game.frames(4);
    await restored;
    await game.frames(2);

    expect(game.drawn(root)).toBe(false);
  });

  // Bug: the same, for an exit no restore can end: only a page reload cleared the root.
  it("drops a root whose exit waits on a handle of its own when a restore comes", async () => {
    exitOf.held = true;

    const game = await startWard();
    const { app } = game;
    const root = app.ui.find("wardRoot") ?? 0;

    app.input.tap(app.ui.find("door") ?? 0);
    await game.frames(10);

    expect(game.drawn(root)).toBe(true);

    const restored = app.flow.restore(app.flow.bookmark());

    await game.frames(4);
    await restored;
    await game.frames(2);

    expect(game.drawn(root)).toBe(false);
  });

  it("drops a root an endless pulse holds when a restore comes", async () => {
    const game = await startWard();
    const { app } = game;
    const root = app.ui.find("wardRoot") ?? 0;

    app.input.tap(app.ui.find("heat") ?? 0);
    await game.frames(4);
    app.input.tap(app.ui.find("door") ?? 0);
    await game.frames(10);

    const restored = app.flow.restore(app.flow.bookmark());

    await game.frames(4);
    await restored;
    await game.frames(2);

    expect(game.drawn(root)).toBe(false);
  });
});
