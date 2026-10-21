/**
 * @file assets plugin — the bundles a leaving scene named stay while its elements play their exit (F51, A Memory
 * Missing's memory → board). The memory scene names a `release: "leave"` bundle; leaving it for the board, the
 * board's next event released the bundle while the memory still faded out over the board, and its pictures turned
 * into placeholders. A small game on the fake page: the memory's root fades out for 600 ms, the board rests and can
 * be entered again.
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

/** The scene bundles, and the memory's own pictures, which leave with it. None has files to fetch. */
const manifest: Manifest = {
  version: 2,
  bundles: {
    memory: { feature: "hold", tier: "lazy", mb: 0, files: [] },
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

const running: Array<{ stop(): Promise<void> }> = [];

/**
 * Starts the game on the memory.
 *
 * @returns The running app, the frame driver and whether anything still leaves.
 */
async function startMemory() {
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
    await game.frames(4);
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
});
