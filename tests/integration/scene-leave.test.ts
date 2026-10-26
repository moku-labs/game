/**
 * @file Root integration — what a live switch shows over the scene being left (spec 33, slice A2): flow, scenes, assets,
 * world and the renderer together, on the fake page over Pixi's own display objects (`drawn-helpers.ts`) and a fake
 * clock that moves 16 ms a frame. The board's textures are still on their way to the GPU (its `assets.warm` is held):
 * the veil of the engine's default is on the stage in the first frame after the answer, the ring from 400 ms after the
 * switch start, and both are gone once the board stands and the veil faded out. The tree oracle checks every frame.
 */
import type { Assets } from "@moku-labs/game";
import { defineGame, Shape, Transform, type } from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { fakeClock } from "@moku-labs/game/testing";
import type * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRAME_MS, openPage, type Watched, watch } from "./drawn-helpers";

const { defineNode, defineFlow, defineFeature, defineScene, projection } = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: string;
  scenes: "ward" | "board";
  strings: Record<string, never>;
}>();

/** Both scene bundles hold no file. */
const MANIFEST: Assets.Manifest = {
  version: 2,
  bundles: {
    ward: { feature: "leave", tier: "lazy", mb: 0, files: [] },
    board: { feature: "leave", tier: "lazy", mb: 0, files: [] }
  }
};

/** The ward's room: one rectangle. */
const wardRoom = projection({
  name: "leave.wardRoom",
  layer: "room",
  from: () => ({ id: "room" }),
  view: () => [Transform({ x: 0, y: 0 }), Shape({ kind: "rect", w: 390, h: 844, fill: 0x9f_b7_b4 })]
});

/** The board's cells: one rectangle in a layer the ward does not declare. */
const boardCells = projection({
  name: "leave.boardCells",
  layer: "cells",
  from: () => ({ id: "cells" }),
  view: () => [
    Transform({ x: 20, y: 400 }),
    Shape({ kind: "rect", w: 350, h: 50, fill: 0x30_40_50 })
  ]
});

const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { room: {} },
  projections: [wardRoom]
});
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [boardCells]
});
const ward = defineNode({
  scene: "ward",
  outcomes: { board: type() },
  rest: true,
  checkpoint: true
});
const board = defineNode({ scene: "board", outcomes: { back: type() }, rest: true });
const mainFlow = defineFlow("main", {
  nodes: { ward, board },
  start: "ward",
  edges: { ward: { board: "board" }, board: { back: "ward" } }
});
const leaveFeature = defineFeature("leave", {
  scenes: [wardScene, boardScene],
  projections: [wardRoom, boardCells]
});

/** A running fixture: its app, its clock and its frame driver with the oracle. */
type Running = Watched & {
  app: ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];
  clock: ReturnType<typeof fakeClock>;
  /** The stage root of the page's Pixi application. */
  stage(): pixi.Container;
};

const running: Running[] = [];

afterEach(async () => {
  for (const fixture of running.splice(0)) {
    fixture.oracle.expectNoMissedFrame();
    await fixture.app.stop();
  }

  vi.restoreAllMocks();
});

/**
 * Steps frames until the flow rests at a node with its gate open.
 *
 * @param fixture - The running fixture.
 * @param path - The path of the rest node.
 */
async function arrive(fixture: Running, path: string): Promise<void> {
  for (let frame = 0; frame < 120; frame += 1) {
    if (fixture.app.flow.state().path === path && fixture.app.flow.gate.state().open) return;
    await fixture.frames(1);
  }

  throw new Error(`The flow did not rest at "${path}".`);
}

/**
 * Starts the fixture on the ward, on a fake clock, and steps until the ward stands.
 *
 * @returns The running fixture.
 */
async function open(): Promise<Running> {
  const page = openPage();
  const clock = fakeClock(1000);
  const { app } = defineGameApp({
    flow: mainFlow,
    safeNode: "ward",
    player: {},
    session: {},
    referenceSide: 390,
    referenceLong: 844,
    features: [leaveFeature],
    pluginConfigs: { log: { mode: "test" }, flow: { holdMs: 0 } }
  }).screen({ manifest: MANIFEST, renderer: page.renderer, clock });

  await app.start();
  app.flow.run().catch(() => undefined);

  const fixture: Running = {
    ...watch(app, page, clock),
    app,
    clock,
    stage: () => page.stage.last().stage
  };

  running.push(fixture);
  await arrive(fixture, "ward");
  await fixture.frames(5);

  return fixture;
}

/**
 * A node of the picture of a scene being left, by its label, wherever it hangs on the stage.
 *
 * @param fixture - The running fixture.
 * @param label - `renderer.leave`, `renderer.leave.cover` or `renderer.leave.ring`.
 * @returns The node, or `undefined` while it hangs nowhere on the stage.
 */
function leaveNode(fixture: Running, label: string): pixi.Container | undefined {
  const top = fixture.stage().children.find(child => child.label === "renderer.leave");

  if (top === undefined || label === "renderer.leave") return top;

  const found = (node: pixi.Container): pixi.Container | undefined =>
    node.label === label ? node : node.children.map(child => found(child)).find(Boolean);

  return found(top);
}

describe("the picture of a scene being left, across the engine", () => {
  // Bug: the veil waits for the next scene's textures (a cold first visit shows nothing for the whole wait), the ring
  // shows before 400 ms or never, or either stays over the board.
  it("shows the veil in the next frame and the ring past afterMs while the board's textures go up, both gone after the swap", async () => {
    const fixture = await open();
    const { app, clock } = fixture;
    const warm = app.assets.warm;
    const held: { release: () => void } = { release: () => undefined };
    const textures = new Promise<void>(resolve => {
      held.release = resolve;
    });
    const show = app.renderer.sync.leave.show;
    const startedAt: number[] = [];

    vi.spyOn(app.assets, "warm").mockImplementation(async bundle => {
      if (bundle === "board") await textures;
      await warm(bundle);
    });
    vi.spyOn(app.renderer.sync.leave, "show").mockImplementation(look => {
      startedAt.push(clock.now());
      show(look);
    });

    expect(app.flow.gate.answer({ intent: "board" })).toBe(true);
    await fixture.frames(1);

    // The next frame: the ward under the veil, already fading in, and no ring yet.
    expect(app.scenes.current()).toBe("ward");
    expect(fixture.stage().children.at(-1)).toBe(leaveNode(fixture, "renderer.leave"));
    expect(leaveNode(fixture, "renderer.leave.cover")?.alpha).toBeGreaterThan(0);
    expect(leaveNode(fixture, "renderer.leave.ring")?.visible).toBe(false);

    const waited: Array<{ sinceStart: number; ring: boolean | undefined }> = [];

    for (let frame = 0; frame < 30; frame += 1) {
      await fixture.frames(1);
      waited.push({
        sinceStart: clock.now() - (startedAt[0] ?? 0),
        ring: leaveNode(fixture, "renderer.leave.ring")?.visible
      });
    }

    expect(startedAt).toHaveLength(1);
    expect(app.scenes.current()).toBe("ward");
    expect(
      waited.filter(frame => frame.sinceStart < 400).every(frame => frame.ring === false)
    ).toBe(true);
    expect(
      waited.filter(frame => frame.sinceStart >= 400).every(frame => frame.ring === true)
    ).toBe(true);
    expect(waited.some(frame => frame.ring === true)).toBe(true);

    held.release();
    await arrive(fixture, "board");
    await fixture.frames(1);

    // The board stands under the veil as it fades out; the ring went with the swap.
    expect(leaveNode(fixture, "renderer.leave.ring")?.visible).toBe(false);

    await fixture.frames(150 / FRAME_MS + 1);

    expect(leaveNode(fixture, "renderer.leave")).toBeUndefined();
  });
});
