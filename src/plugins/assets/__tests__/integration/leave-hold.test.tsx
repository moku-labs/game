/**
 * @file assets plugin — the bundles a leaving scene named stay while its elements play their exit (F51, A Memory
 * Missing's memory → board). The memory scene names a `release: "leave"` bundle; leaving it for the board, the
 * board's next event released the bundle while the memory still faded out over the board, and its pictures turned
 * into placeholders. A small game on the fake page: the memory's root fades out for 600 ms, the board rests and can
 * be entered again. The renderer draws, so a switch builds the board aside and commits it frames after the tap
 * (spec 31): every window of the tests is counted from the commit, the frame `scenes.current()` turns to the board.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  defineComponent,
  defineGame,
  defineMotion,
  defineScene,
  projection,
  screen,
  type
} from "../../../../index";
import type { CompiledMessages } from "../../../i18n/types";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { createFakePixi, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import { Exiting } from "../../../world/ecs/define";
import type { Manifest } from "../../types";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: { "hold.title": Record<string, never> };
}>();

/**
 * The scene bundles, and the memory's own pictures, which leave with it. The memory's scene bundle is shaped as A
 * Memory Missing's splash is: tier `scene`, released on leave. None has files to fetch.
 */
const manifest: Manifest = {
  version: 2,
  bundles: {
    memory: { feature: "hold", tier: "scene", release: "leave", mb: 0, files: [] },
    board: { feature: "hold", tier: "lazy", mb: 0, files: [] },
    "ep.memory": { feature: "ep", tier: "lazy", release: "leave", mb: 0, files: [] }
  }
};

/** The one compiled locale. */
const english: CompiledMessages = { "hold.title": () => [{ kind: "text", text: "hold" }] };

/** The memory's root fades out for 600 ms when it goes, as A Memory Missing's does. */
const fadeOut = defineMotion({
  states: { gone: { Transform: { scale: 0.9 } } },
  transition: { ms: 600 },
  on: { exit: "gone" }
});

/** The memory's screen: its root and the door to the board. */
const Memory = defineComponent("Memory", {
  view: () => (
    <stack key="memoryRoot" motion={fadeOut} style={{ width: 1080, height: 1920 }}>
      <button key="door" intent="board" style={{ width: 200, height: 200 }} />
    </stack>
  )
});

/** The memory's root, a JSX root in layer `scene`. */
const memoryRoot = projection({
  name: "hold.memory",
  layer: "scene",
  from: () => ({ id: "memory" }),
  view: () => <Memory />
});

/** The board's root, in a layer of its own. */
const boardRoot = projection({
  name: "hold.board",
  layer: "cells",
  from: () => ({ id: "board" }),
  view: () => <stack key="boardRoot" style={{ width: 1080, height: 1920 }} />
});

const memoryScene = defineScene("memory", {
  bundle: "memory",
  bundles: () => ["ep.memory"],
  layers: { scene: {} },
  projections: [memoryRoot]
});
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [boardRoot]
});
const memory = defineNode({ rest: true, scene: "memory", outcomes: { board: type() } });
const board = defineNode({ rest: true, scene: "board", outcomes: { again: type() } });
const main = defineFlow("main", {
  nodes: { memory, board },
  start: "memory",
  outcomes: {},
  edges: { memory: { board: "board" }, board: { again: "board" } }
});
const feature = defineFeature("hold", {
  flows: [main],
  scenes: [memoryScene, boardScene],
  projections: [memoryRoot, boardRoot],
  ui: [Memory],
  strings: { en: english }
});

/**
 * The other way a game draws the memory, as A Memory Missing does: one root both scenes list, which shows the memory
 * while the session is there. Leaving it, the root stays mounted, and the memory's elements start their exit only at
 * the next reconcile, after the rest that mounts the board.
 */
const storyRoot = projection({
  name: "hold.story",
  layer: "story",
  from: (_player: unknown, session: { place?: string }) => ({
    id: "story",
    place: session.place ?? "memory"
  }),
  view: (item: { place: string }) => (
    <stack key="storyRoot" style={{ width: 1080, height: 1920 }}>
      {item.place === "memory" ? (
        <stack key="memoryPicture" motion={fadeOut} style={{ width: 400, height: 400 }}>
          <button key="storyDoor" intent="board" style={{ width: 200, height: 200 }} />
        </stack>
      ) : undefined}
    </stack>
  )
});

const storyMemory = defineScene("memory", {
  bundle: "memory",
  bundles: () => ["ep.memory"],
  layers: { story: {} },
  projections: [storyRoot]
});
const storyBoard = defineScene("board", {
  bundle: "board",
  layers: { story: {} },
  projections: [storyRoot]
});
// The board is mounted at its scene stage, the release a rest marked runs at its load stage, and only then its run
// commits the way out of the memory: the memory's elements start their exit at the next reconcile.
const toBoard = defineNode({
  scene: "board",
  outcomes: { gone: type() },
  run: ({ session, out }) => {
    (session as { place?: string }).place = "board";

    return out.gone();
  }
});
const storyMain = defineFlow("main", {
  nodes: { memory, toBoard, board },
  start: "memory",
  outcomes: {},
  edges: { memory: { board: "toBoard" }, toBoard: { gone: "board" }, board: { again: "board" } }
});
const storyFeature = defineFeature("hold", {
  flows: [storyMain],
  scenes: [storyMemory, storyBoard],
  projections: [storyRoot],
  strings: { en: english }
});

const running: Array<{ stop(): Promise<void> }> = [];

/** A game to start: its feature and its main flow. */
type Game = { feature: unknown; flow: unknown };

/** The game of the separate memory root. */
const SEPARATE: Game = { feature, flow: main };

/**
 * Starts a game on the memory.
 *
 * @param game - The feature and its main flow; the game of the separate memory root by default.
 * @param game.feature - The feature.
 * @param game.flow - Its main flow.
 * @returns The running app, the frame driver, the wait for a commit and whether anything still leaves.
 */
async function startMemory(game: Game = SEPARATE) {
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakePixi();
  const app = createApp({
    plugins: [...screen, game.feature as typeof feature],
    pluginConfigs: {
      assets: { manifest },
      flow: { mainFlow: game.flow as typeof main },
      i18n: { locale: "en", fallback: "en" },
      model: {
        initialPlayer: { visits: 0 },
        initialSession: { visits: 0, place: "memory" },
        seed: 1
      },
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

  /**
   * Steps frames until the scene is committed, and no frame after: the commit comes in the `signals` phase of a frame
   * once the build is done, or between two frames when nothing was left to build. The next frame is the swap frame.
   *
   * @param scene - The scene being switched to.
   */
  const untilCommit = async (scene: string): Promise<void> => {
    for (let frame = 0; frame < 60; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      if (app.scenes.current() === scene) return;
      app.time.step(16);
      if (app.scenes.current() === scene) return;
    }

    expect(app.scenes.current()).toBe(scene);
  };

  await untilCommit("memory");
  await frames(6);

  return {
    app,
    frames,
    untilCommit,
    leaving: (): boolean => [...app.world.ecs.query(Exiting)].length > 0
  };
}

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the bundles of a leaving scene (F51)", () => {
  // Bug (A Memory Missing, memory → board): the board's next event released the memory's pictures while the
  // memory still faded out over the board, and they turned into placeholders.
  it("keeps the bundles the memory named while it fades out, and lets them go when the fade is over", async () => {
    const game = await startMemory();
    const { app } = game;

    expect(app.assets.isLoaded("ep.memory")).toBe(true);

    app.input.tap(app.ui.find("door") ?? 0);
    await game.untilCommit("board");
    // The swap frame: the memory's root starts its fade.
    await game.frames(1);
    expect(app.flow.state().path).toBe("board");

    // The board's next event: the release a rest marks runs, while the memory still fades out.
    expect(app.flow.gate.answer({ intent: "again" })).toBe(true);
    await game.frames(4);

    expect(game.leaving()).toBe(true);
    expect(app.assets.isLoaded("ep.memory")).toBe(true);

    // The fade is over: the bundle goes without waiting for another event.
    await game.frames(50);

    expect(game.leaving()).toBe(false);
    expect(app.assets.isLoaded("ep.memory")).toBe(false);
    expect(app.assets.isLoaded("board")).toBe(true);
  });

  // Bug (A Memory Missing, the splash): a scene's own `scene`-tier bundle stayed loaded under the next screens (7.5
  // MiB of the 192 the A26 counts). Released on leave, it goes once the scene that named it finished its exit.
  it("lets the scene's own bundle go, tier scene and released on leave, once its exit is over", async () => {
    const game = await startMemory();
    const { app } = game;

    expect(app.assets.isLoaded("memory")).toBe(true);

    app.input.tap(app.ui.find("door") ?? 0);
    await game.untilCommit("board");

    // The commit frame: the board is the mounted scene, the memory leaves from the next frame on and holds its bundle.
    expect(app.assets.isLoaded("memory")).toBe(true);

    await game.frames(1);

    expect(app.flow.state().path).toBe("board");
    expect(game.leaving()).toBe(true);
    expect(app.assets.isLoaded("memory")).toBe(true);

    await game.frames(50);

    expect(game.leaving()).toBe(false);
    expect(app.assets.isLoaded("memory")).toBe(false);
    expect(app.assets.usage().bundles.map(bundle => bundle.name)).not.toContain("memory");
  });

  // Bug (A Memory Missing, F51b): the memory's root stays mounted; its elements are tagged `Exiting` by the reconcile
  // of the frame after the commit of the board, and the release ran first: nothing carried `Exiting`, the hold ended
  // before the leave began, and the leaving pictures fetched the bundle again.
  it("keeps the bundles when the leave starts only at the reconcile after the commit of the board", async () => {
    const game = await startMemory({ feature: storyFeature, flow: storyMain });
    const { app } = game;

    expect(app.assets.isLoaded("ep.memory")).toBe(true);

    app.input.tap(app.ui.find("storyDoor") ?? 0);
    await game.untilCommit("board");

    // The commit frame: nothing carries `Exiting` yet, and the memory's bundle is held all the same.
    expect(game.leaving()).toBe(false);
    expect(app.assets.isLoaded("ep.memory")).toBe(true);

    // The frame after: the way out of the memory is committed and its picture starts its fade.
    await game.frames(1);

    expect(app.flow.state().path).toBe("board");
    expect(game.leaving()).toBe(true);
    expect(app.assets.isLoaded("ep.memory")).toBe(true);

    await game.frames(50);

    expect(game.leaving()).toBe(false);
    expect(app.assets.isLoaded("ep.memory")).toBe(false);
  });
});
