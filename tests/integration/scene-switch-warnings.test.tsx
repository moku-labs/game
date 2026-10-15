/**
 * @file Root integration — the dev warnings of a scene switch (renderer sync). A teardown that takes a parent and its
 * children away together, or the views of a layer the next scene does not declare, warns nothing; a child that stays
 * and a view that stays in a layer that left still warn, once. A small game on the fake page, shaped as A Memory
 * Missing's ward: a JSX root in layer `scene` with an exit motion whose own `hosts` takes a world sprite (its
 * `location.scene` and `location.pan`), and a board that declares other layers. A test hangs plugin-owned views under
 * the sprite and takes them away from the sprite's own removal, as the game's panorama plugin does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  defineGame,
  defineMotion,
  defineScene,
  Exiting,
  Layer,
  Parent,
  projection,
  Shape,
  Sprite,
  screen,
  Transform,
  type
} from "../../src";
import type { Manifest } from "../../src/plugins/assets/types";
import type { CompiledMessages } from "../../src/plugins/i18n/types";
import { installFakeDom } from "../../src/plugins/renderer/__tests__/fake-dom";
import { createFakePixi, FakeTexture } from "../../src/plugins/renderer/__tests__/fake-pixi";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: { "switch.title": Record<string, never> };
}>();

/** The two scene bundles, with no files to fetch. */
const manifest: Manifest = {
  version: 2,
  bundles: {
    ward: { feature: "switch", tier: "lazy", mb: 0, files: [] },
    board: { feature: "switch", tier: "lazy", mb: 0, files: [] }
  }
};

/** The one compiled locale. */
const english: CompiledMessages = { "switch.title": () => [{ kind: "text", text: "switch" }] };

/** The ward leaves as A Memory Missing's does: it grows for 160 ms before it goes. */
const leave = defineMotion({
  states: { gone: { Transform: { scale: 1.05 } } },
  transition: { ms: 160 },
  on: { exit: "gone" }
});

/** The room: a world sprite the ward's root hosts. */
const pan = projection({
  name: "switch.pan",
  layer: "scene",
  from: () => [{ id: "pan" }],
  key: (item: { id: string }) => item.id,
  view: () => [
    Sprite({ texture: "switch.pan", width: 400, height: 400 }),
    Transform({ x: 100, y: 100 })
  ]
});

/** The ward's root: a JSX root in `scene` that hosts the room and leaves with a motion. */
const wardRoot = projection({
  name: "switch.ward",
  layer: "scene",
  from: () => ({ id: "ward" }),
  view: () => (
    <stack
      key="wardRoot"
      hosts={["switch.pan"]}
      motion={leave}
      style={{ width: 1080, height: 1920 }}
    >
      <button key="door" intent="board" style={{ width: 200, height: 200 }} />
    </stack>
  )
});

/** The board's root, in a layer of its own. */
const boardRoot = projection({
  name: "switch.board",
  layer: "cells",
  from: () => ({ id: "board" }),
  view: () => <stack key="boardRoot" style={{ width: 1080, height: 1920 }} />
});

const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { scene: {} },
  projections: [wardRoot, pan]
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
const feature = defineFeature("switch", {
  flows: [main],
  scenes: [wardScene, boardScene],
  projections: [pan, wardRoot, boardRoot],
  strings: { en: english }
});

/** The owner of the views the test hangs under the room, as the game's panorama plugin owns its own. */
const PANORAMA = { kind: "plugin", name: "panorama" } as const;

/** Frames of the ward's whole exit and more: 30 × 16 ms. */
const SETTLED = 30;

/**
 * Starts the game on the ward, every warning kept.
 *
 * @returns The running app, the room's entity, the frame driver and the reader of the kept warnings.
 */
async function startWard() {
  const warned: Array<{ event: string; data: unknown }> = [];

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
  app.renderer.sync.textures.provide(() => new FakeTexture({}) as never);
  app.flow.run().catch(() => undefined);

  /**
   * Steps frames of 16 ms, the runner given its turn before each.
   *
   * @param count - How many.
   * @param each - What runs after each frame, with its number.
   */
  const frames = async (count: number, each?: (frame: number) => void): Promise<void> => {
    for (let frame = 1; frame <= count; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      app.time.step(16);
      each?.(frame);
    }
  };

  await frames(6);

  return {
    app,
    room: app.world.projection.entitiesOf("switch.pan")[0] ?? 0,
    frames,
    warnings: (event: string): unknown[] =>
      warned.filter(entry => entry.event === event).map(entry => entry.data),
    toBoard: async (each?: (frame: number) => void): Promise<void> => {
      app.input.tap(app.ui.find("door") ?? 0);
      await frames(SETTLED, each);
      expect(app.flow.state().path).toBe("board");
    }
  };
}

/** A started ward. */
type Ward = Awaited<ReturnType<typeof startWard>>;

/**
 * A plugin-owned square hung under a parent.
 *
 * @param app - The running app.
 * @param parent - The parent entity.
 * @returns The square.
 */
function squareUnder(app: Ward["app"], parent: number): number {
  return app.world.ecs.spawn(PANORAMA, [
    Parent({ entity: parent }),
    Transform(),
    Shape({ w: 50, h: 50, fill: 0xff_00_00 })
  ]);
}

const running: Ward["app"][] = [];

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the warnings of a scene switch", () => {
  // Bug (A Memory Missing, ward → board): the room left before the plugin's surface and halo that leave in the same
  // teardown, and the ward's root that plays its exit was named a view left without a layer: two warnings on every
  // switch, for a teardown that is whole.
  it("takes a hosted sprite, the plugin's views under it and the leaving root of a layer the board lacks away without a warning", async () => {
    const ward = await startWard();
    const { app, room } = ward;
    const ecs = app.world.ecs;
    const surface = squareUnder(app, room);
    const halo = squareUnder(app, room);

    running.push(app);
    // The panorama gives back what it put on the room in the room's own removal: the surface goes, the halo fades.
    ecs.onRemoved(Sprite, entity => {
      if (entity !== room) return;

      ecs.despawn(surface);
      ecs.tag(halo, Exiting);
    });
    await ward.frames(2);
    await ward.toBoard(frame => {
      if (frame === 6) ecs.despawn(halo);
    });

    expect(ward.warnings("renderer: parent left before its children")).toEqual([]);
    expect(ward.warnings("renderer: views left without a layer")).toEqual([]);
  });

  // Bug: a teardown rule that hid every child of a parent that left would hide a child that stays, drawn nowhere.
  it("still names the one child the plugin keeps under the sprite that left", async () => {
    const ward = await startWard();
    const { app, room } = ward;
    const surface = squareUnder(app, room);
    const kept = squareUnder(app, room);

    running.push(app);
    app.world.ecs.onRemoved(Sprite, entity => {
      if (entity === room) app.world.ecs.despawn(surface);
    });
    await ward.frames(2);
    await ward.toBoard();

    expect(ward.warnings("renderer: parent left before its children")).toEqual([
      { parent: room, orphans: [kept] }
    ]);
  });

  // Bug: a teardown rule that hid every view of a layer that left would hide a view that stays, drawn nowhere.
  it("still names the one view that stays in the layer the board lacks, and not the root that leaves", async () => {
    const ward = await startWard();
    const { app } = ward;
    const lamp = app.world.ecs.spawn(PANORAMA, [
      Layer({ name: "scene" }),
      Transform({ x: 50, y: 50 }),
      Shape({ w: 50, h: 50, fill: 0x00_ff_00 })
    ]);

    running.push(app);
    await ward.frames(2);
    await ward.toBoard();

    expect(ward.warnings("renderer: views left without a layer")).toEqual([{ entities: [lamp] }]);
  });
});
