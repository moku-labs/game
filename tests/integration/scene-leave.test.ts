/**
 * @file Root integration — what a live switch shows over the scene being left (spec 33, slices A2 and A3): flow,
 * scenes, assets, world and the renderer together, on the fake page over Pixi's own display objects (`drawn-helpers.ts`)
 * and a fake clock that moves 16 ms a frame. The board's textures are still on their way to the GPU (its `assets.warm`
 * is held), or its one file is still downloading (the fetch of its io is held, a cold first visit): the veil of the
 * engine's default is on the stage in the first frame after the answer, the ring from 400 ms after the switch start,
 * and both are gone once the board stands and the veil faded out. A loader projection is built and hidden while the
 * ward stands (F103), shown the frame after it is due, and fades out with the veil after the swap (F107 part 3). A
 * download that fails takes the veil down at once, on a retry, while the safe node's `recover` waits at the gate, and
 * on a fatal failure. The tree oracle checks every frame.
 */
import type { Assets, Scenes } from "@moku-labs/game";
import { defineGame, Layer, Shape, Transform, type } from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { fakeClock } from "@moku-labs/game/testing";
import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DrawnPage, FRAME_MS, openPage, type Watched, watch } from "./drawn-helpers";

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

/** The same two bundles, the board's with one image: a cold first visit downloads it in the `load` stage. */
const COLD_MANIFEST: Assets.Manifest = {
  version: 2,
  bundles: {
    ...MANIFEST.bundles,
    board: {
      feature: "leave",
      tier: "lazy",
      mb: 0.001,
      files: [{ key: "board.cells", path: "board/cells.png", width: 4, height: 4, mb: 0.001 }]
    }
  }
};

/** The io of a page whose network holds every download until the test answers it. */
type HeldNetwork = {
  io: Assets.AssetsIo;
  /** The URLs fetched and not answered yet. */
  waiting(): string[];
  /** Answers every waiting download. */
  release(): void;
  /** Fails every waiting download, the way a lost connection does. */
  fail(): void;
};

/**
 * Makes the io of a page whose downloads wait for the test: a fetch answers once `release` was called, or rejects
 * once `fail` was; an image decodes to 4 x 4 and becomes a real Pixi texture of that size with no pixels.
 *
 * @returns The io and what answers its downloads.
 */
function heldNetwork(): HeldNetwork {
  const held: Array<{ url: string; resolve: () => void; reject: (error: Error) => void }> = [];
  const blob = new Blob([new Uint8Array(4)]);

  return {
    waiting: () => held.map(entry => entry.url),
    release: () => {
      for (const entry of held.splice(0)) entry.resolve();
    },
    fail: () => {
      for (const entry of held.splice(0)) entry.reject(new Error("offline"));
    },
    io: {
      fetch: async url => {
        const answer = Promise.withResolvers<void>();

        held.push({ url, resolve: answer.resolve, reject: answer.reject });
        await answer.promise;

        return {
          ok: true,
          status: 200,
          // eslint-disable-next-line unicorn/no-null -- a `Response` answers a missing header with null.
          headers: { get: () => null },
          json: () => Promise.resolve({}),
          blob: () => Promise.resolve(blob),
          text: () => Promise.resolve(""),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(4))
        };
      },
      decode: () => Promise.resolve({ width: 4, height: 4 } as unknown as Assets.DecodedImage),
      createTexture: () =>
        new pixi.Texture({
          source: new pixi.TextureSource({ width: 4, height: 4 })
        }) as unknown as Assets.Texture,
      sliceTexture: page => page,
      destroyTexture: texture => (texture as unknown as pixi.Texture).destroy()
    }
  };
}

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

/** The game's own loading screen: one rectangle in a layer of its own, which the ward declares. */
const loadingScreen = projection({
  name: "leave.loading",
  layer: "loading",
  from: () => ({ id: "loading" }),
  view: () => [
    Transform({ x: 95, y: 372 }),
    Shape({ kind: "rect", w: 200, h: 100, fill: 0xff_ff_ff })
  ]
});

const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { room: {}, loading: {} },
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
  projections: [wardRoom, boardCells, loadingScreen]
});

/**
 * The ward of the failure tests: a safe node whose `recover` asks the player first, waiting at the gate for "retry".
 * It leaves for the board straight (a rest node: a failure retries the board itself) or through `travel`.
 */
const safeWard = defineNode({
  scene: "ward",
  outcomes: { board: type(), travel: type() },
  rest: true,
  checkpoint: true,
  recover: async ({ fx }) => {
    await fx({ kind: "offline", answers: ["retry"] });
  }
});
/** A transit node that switches to the board: a failure in it rolls back to the ward. */
const travel = defineNode({
  scene: "board",
  outcomes: { arrived: type() },
  run: ({ out }) => out.arrived()
});
const safeBoard = defineNode({
  scene: "board",
  outcomes: { back: type() },
  rest: true,
  checkpoint: true
});
const failureFlow = defineFlow("main", {
  nodes: { ward: safeWard, travel, board: safeBoard },
  start: "ward",
  edges: {
    ward: { board: "board", travel: "travel" },
    travel: { arrived: "board" },
    board: { back: "ward" }
  }
});

/** A running fixture: its app, its clock and its frame driver with the oracle. */
type Running = Watched & {
  app: ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];
  clock: ReturnType<typeof fakeClock>;
  /** What `run()` rejected with, once it did: a fatal failure. */
  ended: { error: unknown };
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
 * @param leave - The `leave` of the config; the engine's default when left out.
 * @param network - The manifest and the io of the page; bundles with no file and the engine's io when left out.
 * @param network.manifest - The manifest.
 * @param network.io - The io its files are fetched with.
 * @returns The running fixture.
 */
async function open(
  leave?: Scenes.SceneLeave,
  network?: { manifest: Assets.Manifest; io: Assets.AssetsIo }
): Promise<Running> {
  const page = openPage();
  const clock = fakeClock(1000);
  const seams = network ?? { manifest: MANIFEST };
  const { app } = defineGameApp({
    flow: mainFlow,
    safeNode: "ward",
    player: {},
    session: {},
    referenceSide: 390,
    referenceLong: 844,
    features: [leaveFeature],
    pluginConfigs: {
      log: { mode: "test" },
      flow: { holdMs: 0 },
      ...(leave === undefined ? {} : { scenes: { leave } })
    }
  }).screen({ ...seams, renderer: page.renderer, clock });

  return track(app, page, clock);
}

/**
 * Starts an app on the ward and watches it: its frames, its stage and how its `run()` ended.
 *
 * @param app - The screen app, not started.
 * @param page - The page it draws on.
 * @param clock - The fake clock it runs on.
 * @returns The running fixture, at the ward.
 */
async function track(
  app: Running["app"],
  page: DrawnPage,
  clock: ReturnType<typeof fakeClock>
): Promise<Running> {
  await app.start();

  const ended: Running["ended"] = { error: undefined };

  app.flow.run().catch((error: unknown) => {
    ended.error = error;
  });

  const fixture: Running = {
    ...watch(app, page, clock),
    app,
    clock,
    ended,
    stage: () => page.stage.last().stage
  };

  running.push(fixture);
  await arrive(fixture, "ward");
  await fixture.frames(5);

  return fixture;
}

/**
 * Starts the failure graph on the ward, with the cold manifest over a held network.
 *
 * @param network - The network the board's file is fetched over.
 * @param flow - Which node is safe and how often a failure is retried.
 * @param flow.safeNode - The safe node.
 * @param flow.retries - Failures in a row that are retried before the loop gives up.
 * @returns The running fixture, at the ward.
 */
function openFailing(
  network: HeldNetwork,
  flow: { safeNode: "ward" | "board"; retries: number }
): Promise<Running> {
  const page = openPage();
  const clock = fakeClock(1000);
  const { app } = defineGameApp({
    flow: failureFlow,
    safeNode: flow.safeNode,
    player: {},
    session: {},
    referenceSide: 390,
    referenceLong: 844,
    features: [leaveFeature],
    pluginConfigs: { log: { mode: "test" }, flow: { holdMs: 0, retries: flow.retries } }
  }).screen({ manifest: COLD_MANIFEST, io: network.io, renderer: page.renderer, clock });

  return track(app, page, clock);
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

/**
 * Holds the board's textures on their way to the GPU: the switch waits at its warm until the test lets them go.
 *
 * @param fixture - The running fixture, at the ward.
 * @returns What lets the textures go.
 */
function holdBoardTextures(fixture: Running): () => void {
  const warm = fixture.app.assets.warm;
  const held: { release: () => void } = { release: () => undefined };
  const textures = new Promise<void>(resolve => {
    held.release = resolve;
  });

  vi.spyOn(fixture.app.assets, "warm").mockImplementation(async bundle => {
    if (bundle === "board") await textures;
    await warm(bundle);
  });

  return () => held.release();
}

/**
 * Tells whether an entity's display object hangs under a node.
 *
 * @param fixture - The running fixture.
 * @param entity - The entity.
 * @param ancestor - The node.
 * @returns True when the node is one of its ancestors.
 */
function hangsUnder(
  fixture: Running,
  entity: number,
  ancestor: pixi.Container | undefined
): boolean {
  let node = fixture.app.renderer.sync.displayOf(entity) as pixi.Container | undefined;

  while (node !== undefined && node !== null) {
    if (node === ancestor) return true;
    node = node.parent ?? undefined;
  }

  return false;
}

/**
 * The root of the loader projection the ward holds built and hidden: the entity in the layer `loading`.
 *
 * @param fixture - The running fixture, at the ward.
 * @returns The entity.
 * @throws {Error} When nothing is built in that layer.
 */
function heldLoader(fixture: Running): number {
  for (const [entity, layer] of fixture.app.world.ecs.query(Layer)) {
    if (layer.name === "loading") return entity;
  }

  throw new Error("No loader view is built in the layer loading.");
}

/**
 * Records the frames the renderer calls the loader's `due` in: the look the switch shows is handed on with a `due`
 * that notes the frame the test set.
 *
 * @param fixture - The running fixture, at the ward.
 * @returns The frame the test is in, which it sets, and the frames `due` was called in.
 */
function watchDue(fixture: Running): { frame: number; frames: number[] } {
  const watched = { frame: 0, frames: [] as number[] };
  const leave = fixture.app.renderer.sync.leave;
  const show = leave.show;

  vi.spyOn(leave, "show").mockImplementation(look => {
    const loader = look.loader;
    const due = loader?.due;

    if (loader === undefined || due === undefined) {
      show(look);

      return;
    }

    show({
      ...look,
      loader: {
        ...loader,
        due: () => {
          watched.frames.push(watched.frame);

          return due();
        }
      }
    });
  });

  return watched;
}

/**
 * The alpha an entity's display object is drawn at: its own and every ancestor's, up to the stage.
 *
 * @param fixture - The running fixture.
 * @param entity - The entity.
 * @returns The product of the alphas, 0 when it hangs nowhere.
 */
function drawnAlpha(fixture: Running, entity: number): number {
  let node = fixture.app.renderer.sync.displayOf(entity) as pixi.Container | undefined;
  let alpha = 1;

  while (node !== undefined && node !== null) {
    alpha *= node.visible ? node.alpha : 0;
    node = node.parent ?? undefined;
  }

  return alpha;
}

describe("the picture of a scene being left, across the engine", () => {
  // Bug: the veil waits for the next scene's textures (a cold first visit shows nothing for the whole wait), the ring
  // shows before 400 ms or never, or either stays over the board.
  it("shows the veil in the next frame and the ring past afterMs while the board's textures go up, both gone after the swap", async () => {
    const fixture = await open();
    const { app, clock } = fixture;
    const release = holdBoardTextures(fixture);
    const show = app.renderer.sync.leave.show;
    const startedAt: number[] = [];

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

    release();
    await arrive(fixture, "board");
    await fixture.frames(1);

    // The board stands under the veil as it fades out; the ring went with the swap.
    expect(leaveNode(fixture, "renderer.leave.ring")?.visible).toBe(false);

    await fixture.frames(150 / FRAME_MS + 1);

    expect(leaveNode(fixture, "renderer.leave")).toBeUndefined();
  });

  // Bug: the game's loading screen is shown at the tap (its views drawn in the frame of the first answer, and for every
  // warm switch), is drawn under the veil, or stays mounted over the board once the veil faded out.
  it("shows a loader projection once it is due, draws it above the veil, and unmounts it after the veil's fade", async () => {
    const fixture = await open({ loader: { afterMs: 100, projection: "leave.loading" } });
    const { app } = fixture;
    const release = holdBoardTextures(fixture);

    app.flow.gate.answer({ intent: "board" });
    await fixture.frames(3);

    expect(app.world.projection.entitiesOf("leave.loading")).toEqual([]);

    await fixture.frames(5);

    const [screen] = app.world.projection.entitiesOf("leave.loading");

    expect(screen).toBeDefined();
    expect(hangsUnder(fixture, screen ?? 0, leaveNode(fixture, "renderer.leave.layer"))).toBe(true);
    expect(leaveNode(fixture, "renderer.leave.layer")?.visible).toBe(true);

    release();
    await arrive(fixture, "board");
    await fixture.frames(150 / FRAME_MS + 1);

    expect(app.world.projection.entitiesOf("leave.loading")).toEqual([]);
    expect(app.renderer.sync.displayOf(screen ?? 0)).toBeUndefined();
  });

  // Bug: the loading screen is built in the frame it is due (a spawn, its view and its first draw in the middle of a
  // switch: 33–49 ms on the A26), shows a new root instead of the one built while the ward stood, or goes at the swap
  // before the veil faded out over the board (F107 part 3).
  it("shows the loader built while the ward stood: the same root the frame after its due, fading out with the veil", async () => {
    const fixture = await open({ loader: { afterMs: 100, projection: "leave.loading" } });
    const { app } = fixture;
    const held = heldLoader(fixture);

    // The ward stands: its loader is built and hidden, nothing of it is shown.
    expect(app.world.projection.isBuilding(held)).toBe(true);
    expect(app.world.projection.entitiesOf("leave.loading")).toEqual([]);

    const release = holdBoardTextures(fixture);
    const dueIn = watchDue(fixture);
    const entities = app.world.ecs.count();
    const shown: Array<readonly number[]> = [];

    app.flow.gate.answer({ intent: "board" });
    for (let frame = 0; frame < 12; frame += 1) {
      dueIn.frame = frame;
      await fixture.frames(1);
      shown.push(app.world.projection.entitiesOf("leave.loading"));
    }

    const [due] = dueIn.frames;

    expect(dueIn.frames).toHaveLength(1);
    expect(shown[due ?? 0]).toEqual([]);
    expect(shown[(due ?? 0) + 1]).toEqual([held]);
    expect(app.world.ecs.count()).toBe(entities);
    expect(hangsUnder(fixture, held, leaveNode(fixture, "renderer.leave.layer"))).toBe(true);

    release();
    await arrive(fixture, "board");
    await fixture.frames(1);

    // The board stands; the loader is still drawn over it, fading out with the veil.
    expect(app.world.projection.entitiesOf("leave.loading")).toEqual([held]);
    expect(hangsUnder(fixture, held, fixture.stage())).toBe(true);
    expect(drawnAlpha(fixture, held)).toBeGreaterThan(0);
    expect(drawnAlpha(fixture, held)).toBeLessThan(1);

    await fixture.frames(150 / FRAME_MS + 1);

    expect(app.world.projection.entitiesOf("leave.loading")).toEqual([]);
    expect(app.renderer.sync.displayOf(held)).toBeUndefined();
    expect(leaveNode(fixture, "renderer.leave")).toBeUndefined();
  });

  // Bug: the veil waits for the `load` stage: a cold first visit downloads the board's files first and shows nothing
  // for the whole download (measured on the A26 with slice A2).
  it("shows the veil in the next frame while the board's bundle is still downloading", async () => {
    const network = heldNetwork();
    const fixture = await open(undefined, { manifest: COLD_MANIFEST, io: network.io });
    const { app } = fixture;

    expect(app.flow.gate.answer({ intent: "board" })).toBe(true);
    await fixture.frames(1);

    // The next frame: the board's image is still on its way, the ward stands under the veil.
    expect(network.waiting()).toHaveLength(1);
    expect(network.waiting()[0]).toContain("board/cells.png");
    expect(app.assets.isLoaded("board")).toBe(false);
    expect(app.scenes.current()).toBe("ward");
    expect(fixture.stage().children.at(-1)).toBe(leaveNode(fixture, "renderer.leave"));
    expect(leaveNode(fixture, "renderer.leave.cover")?.alpha).toBeGreaterThan(0);

    network.release();
    await arrive(fixture, "board");
    await fixture.frames(150 / FRAME_MS + 1);

    expect(app.assets.isLoaded("board")).toBe(true);
    expect(leaveNode(fixture, "renderer.leave")).toBeUndefined();
  });
});

/**
 * Answers the ward with an intent and steps one frame: the veil is up while the board's file downloads.
 *
 * @param fixture - The running fixture, at the ward.
 * @param network - Its network.
 * @param intent - `"board"` or `"travel"`.
 */
async function leaveUnderVeil(
  fixture: Running,
  network: HeldNetwork,
  intent: "board" | "travel"
): Promise<void> {
  expect(fixture.app.flow.gate.answer({ intent })).toBe(true);
  await fixture.frames(1);

  expect(network.waiting()).toHaveLength(1);
  expect(leaveNode(fixture, "renderer.leave.cover")?.alpha).toBeGreaterThan(0);
}

describe("a download that fails under the veil", () => {
  // Bug: the `load` stage throws and nothing drops the veil: the ward the rollback returns to stays dimmed, the ring
  // turning over it, while the player answers it again. This path is guarded twice: by the abort of the failed node,
  // and by the backstop of the ward's `begin`, which drops a look left over. The two cases below prove the abort alone:
  // no `begin` comes before the veil must go.
  it("is gone when the rollback returns to the ward", async () => {
    const network = heldNetwork();
    const fixture = await openFailing(network, { safeNode: "ward", retries: 1 });
    const { app } = fixture;

    await leaveUnderVeil(fixture, network, "travel");
    network.fail();
    await arrive(fixture, "ward");
    await fixture.frames(1);

    expect(app.log.trace().filter(entry => entry.event === "flow:error")).toHaveLength(1);
    expect(app.scenes.current()).toBe("ward");
    expect(app.flow.gate.state().allowed).toEqual(["board", "travel"]);
    expect(leaveNode(fixture, "renderer.leave")).toBeUndefined();
  });

  // Bug: after the give-up the safe node's `recover` runs before any stage of the next node, so a veil only the next
  // `begin` drops covers the question `recover` asks at the gate.
  it("is gone while the safe node's recover waits at the gate", async () => {
    const network = heldNetwork();
    const fixture = await openFailing(network, { safeNode: "ward", retries: 0 });
    const { app } = fixture;

    await leaveUnderVeil(fixture, network, "board");
    network.fail();
    await fixture.frames(2);

    // The recovery waits for the player's "retry"; the ward under it is undimmed.
    expect(app.flow.gate.state()).toMatchObject({ open: true, allowed: ["retry"] });
    expect(app.scenes.current()).toBe("ward");
    expect(leaveNode(fixture, "renderer.leave")).toBeUndefined();

    expect(app.flow.gate.answer({ intent: "retry" })).toBe(true);
    await arrive(fixture, "ward");

    expect(app.flow.gate.state().allowed).toEqual(["board", "travel"]);
  });

  // Bug: a failure inside the safe node rejects `run()` with nothing after it, and the veil the safe node's `begin`
  // showed stays over the game until it stops.
  it("is gone after a fatal failure inside the safe node", async () => {
    const network = heldNetwork();
    const fixture = await openFailing(network, { safeNode: "board", retries: 0 });
    const { app } = fixture;

    await leaveUnderVeil(fixture, network, "board");
    network.fail();
    // The give-up enters the safe node, the board: its `begin` shows the veil again while its file downloads.
    await fixture.frames(1);

    expect(network.waiting()).toHaveLength(1);
    expect(leaveNode(fixture, "renderer.leave.cover")?.alpha).toBeGreaterThan(0);

    network.fail();
    await fixture.frames(2);

    expect(String(fixture.ended.error)).toContain("failed while the graph was recovering");
    expect(app.scenes.current()).toBe("ward");
    expect(leaveNode(fixture, "renderer.leave")).toBeUndefined();
  });
});
