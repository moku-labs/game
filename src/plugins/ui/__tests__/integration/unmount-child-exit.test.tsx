/**
 * @file ui plugin — a root that leaves with its scene ends with its own exit (F55, A Memory Missing's
 * memory room). The memory's root fades out in 600 ms; the overlay on its left side has a 900 ms
 * exit of its own. The sweep waited for every exit under the root, so the root and the bundle the
 * leaving scene holds stayed 300 ms past the memory's own leave. A root whose top element plays an
 * exit now goes when that exit ends; one whose top plays none still waits for its children.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  Alpha,
  createApp,
  defineComponent,
  defineGame,
  defineScene,
  projection,
  screen,
  type
} from "../../../../index";
import type { Manifest } from "../../../assets/types";
import type { CompiledMessages } from "../../../i18n/types";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { createFakePixi, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import type { ElementMotion } from "../../jsx/types";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: { "unmount.title": Record<string, never> };
}>();

/** The two scene bundles, with no files to fetch. */
const manifest: Manifest = {
  version: 2,
  bundles: {
    memory: { feature: "unmount", tier: "lazy", mb: 0, files: [] },
    ward: { feature: "unmount", tier: "lazy", mb: 0, files: [] }
  }
};

/** The one compiled locale. */
const english: CompiledMessages = { "unmount.title": () => [{ kind: "text", text: "unmount" }] };

/**
 * An exit that fades the element out.
 *
 * @param ms - How long it plays.
 * @returns The motion prop.
 */
function fade(ms: number): ElementMotion {
  return { exit: view => view.tween(Alpha, { alpha: 0 }, { ms, reduced: "keep" }) };
}

/** Whether the memory's root plays its own 160 ms fade, set by a test. */
const rootOf = { fades: true };

/** The memory's screen: the root, the overlay with a long exit, and the door to the ward. */
const Memory = defineComponent("Memory", {
  view: () => (
    <stack
      key="memRoot"
      motion={rootOf.fades ? fade(160) : {}}
      components={[Alpha()]}
      style={{ width: 1080, height: 1920 }}
    >
      <stack
        key="memLeft"
        motion={fade(900)}
        components={[Alpha()]}
        style={{ width: 200, height: 200 }}
      />
      <button key="door" intent="ward" style={{ width: 200, height: 200 }} />
    </stack>
  )
});

/** The memory's root, a JSX root in layer `scene`. */
const memoryRoot = projection({
  name: "unmount.memory",
  layer: "scene",
  from: () => ({ id: "memory" }),
  view: () => <Memory />
});

/** The ward's root, in a layer of its own. */
const wardRoot = projection({
  name: "unmount.ward",
  layer: "cells",
  from: () => ({ id: "ward" }),
  view: () => <stack key="wardRoot" style={{ width: 1080, height: 1920 }} />
});

const memoryScene = defineScene("memory", {
  bundle: "memory",
  layers: { scene: {} },
  projections: [memoryRoot]
});
const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { cells: {} },
  projections: [wardRoot]
});
const memory = defineNode({ rest: true, scene: "memory", outcomes: { ward: type() } });
const ward = defineNode({ rest: true, scene: "ward", outcomes: { back: type() } });
const main = defineFlow("main", {
  nodes: { memory, ward },
  start: "memory",
  outcomes: {},
  edges: { memory: { ward: "ward" }, ward: { back: "memory" } }
});
const feature = defineFeature("unmount", {
  flows: [main],
  scenes: [memoryScene, wardScene],
  projections: [memoryRoot, wardRoot],
  ui: [Memory],
  strings: { en: english }
});

const running: Array<{ stop(): Promise<void> }> = [];

/**
 * Starts the game on the memory.
 *
 * @returns The running app, the frame driver and whether an entity is drawn.
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
    drawn: (entity: number): boolean => app.renderer.sync.displayOf(entity) !== undefined
  };
}

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  rootOf.fades = true;
});

describe("a root that leaves with its scene (F55)", () => {
  // Bug (A Memory Missing, memory → ward): the overlay's 900 ms exit held the root 740 ms past its 160 ms fade.
  it("goes when its own exit ends, a longer exit under it cut", async () => {
    const game = await startMemory();
    const { app } = game;
    const root = app.ui.find("memRoot") ?? 0;
    const left = app.ui.find("memLeft") ?? 0;

    app.input.tap(app.ui.find("door") ?? 0);
    await game.frames(4);

    expect(app.flow.state().path).toBe("ward");
    expect(game.drawn(root)).toBe(true);

    // 20 frames: 320 ms, past the root's 160 ms, short of the overlay's 900 ms.
    await game.frames(20);

    expect(game.drawn(root)).toBe(false);
    expect(game.drawn(left)).toBe(false);
  });

  // The other side: a root whose top plays no exit is left by its children, so their exits still play.
  it("waits for the exits under a top that plays none", async () => {
    rootOf.fades = false;

    const game = await startMemory();
    const { app } = game;
    const root = app.ui.find("memRoot") ?? 0;
    const left = app.ui.find("memLeft") ?? 0;

    app.input.tap(app.ui.find("door") ?? 0);
    await game.frames(24);

    expect(game.drawn(left)).toBe(true);
    expect(game.drawn(root)).toBe(true);

    // 60 more frames: past the overlay's 900 ms.
    await game.frames(60);

    expect(game.drawn(left)).toBe(false);
    expect(game.drawn(root)).toBe(false);
  });
});
