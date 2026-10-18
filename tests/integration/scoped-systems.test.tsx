/**
 * @file Root integration — systems that run where their feature is (spec 28). A small game on the screen set, no
 * canvas, a fake clock: `screens` declares the ward and the board scenes and owns the main flow; `board` owns the
 * board's sub-flow and its items; `shop` a sheet in the board scene, open while `session.shop`; `ward` the room of
 * the ward scene; `reward` a popup component; `orders` one node of the board's flow. Each of `board`, `shop`, `ward`
 * writes a look on its own views from `res(Now)` in phase `animate`; `reward` counts its runs. Cross-plugin: flow
 * (the stack), world (the scope and the views), scenes (the hold of the mounted scene), ui (the hold of a popup
 * root), assets (a held bundle keeps the board's scene on screen after its node left).
 */
import type { Assets, Flow } from "@moku-labs/game";
import {
  component,
  defineGame,
  defineScene,
  exit,
  mut,
  Now,
  projection,
  system,
  Transform,
  type
} from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { describe, expect, it } from "vitest";
import { graphHash } from "../../src/plugins/flow/runner/registry";
import { tick } from "./helpers";

type Player = { coins: number };
type Session = { shop: boolean };

const { defineNode, defineFlow, defineFeature, defineComponent, popup } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, never>;
}>();

/** Where the fake clock starts. */
const START = 1_000_000;

/** The look each scoped feature writes on its own views, from the frame's moment. */
const BoardLook = component("scoped.boardLook", { shade: 0 });
const ShopLook = component("scoped.shopLook", { shade: 0 });
const WardLook = component("scoped.wardLook", { shade: 0 });

/** How often each scoped system ran, per app. */
type Runs = { board: number; shop: number; ward: number; reward: number };

/** One row of a projection. */
type Row = { id: string };

/** The board's two items. */
const boardItems = projection({
  name: "board.items",
  layer: "cells",
  from: (): Row[] => [{ id: "a" }, { id: "b" }],
  key: (row: Row) => row.id,
  view: () => [BoardLook(), Transform()]
});

/** The shop sheet, in the board scene, while the session says the shop is open. */
const shopSheet = projection({
  name: "shop.sheet",
  layer: "cells",
  from: (_player: Player, session: Session): Row[] => (session.shop ? [{ id: "sheet" }] : []),
  key: (row: Row) => row.id,
  view: () => [ShopLook(), Transform()]
});

/** The ward's room. */
const wardRoom = projection({
  name: "ward.room",
  layer: "room",
  from: (): Row[] => [{ id: "room" }],
  key: (row: Row) => row.id,
  view: () => [WardLook(), Transform()]
});

/** The reward popup. */
const RewardPopup = defineComponent("Reward", {
  outcomes: { ok: type() },
  view: () => (
    <panel key="rewardPanel" style={{ width: 400, height: 300 }}>
      <button key="ok" intent="ok" style={{ width: 100, height: 60 }} />
    </panel>
  )
});

const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { room: {} },
  projections: [wardRoom]
});
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [boardItems, shopSheet]
});

const awaitIntent = defineNode({
  rest: true,
  scene: "board",
  outcomes: { openShop: type(), celebrate: type(), deliver: type(), leave: type() }
});
const openShop = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.shop = true;

    return out.done();
  }
});
const shopping = defineNode({ rest: true, outcomes: { buy: type(), close: type() } });
const buy = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.coins += 1;

    return out.done();
  }
});
const closeShop = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.shop = false;

    return out.done();
  }
});
const celebrate = defineNode({
  outcomes: { done: type() },
  run: async ({ fx, out }) => {
    await fx(popup(RewardPopup, {}));

    return out.done();
  }
});
/** A node of the board's flow that `orders` lists: `orders` owns it, not `board`. */
const deliver = defineNode({ rest: true, outcomes: { done: type() } });

const boardPlay = defineFlow("boardPlay", {
  nodes: { awaitIntent, openShop, shopping, buy, closeShop, celebrate, deliver },
  start: "awaitIntent",
  outcomes: { left: type() },
  edges: {
    awaitIntent: {
      openShop: "openShop",
      celebrate: "celebrate",
      deliver: "deliver",
      leave: exit("left")
    },
    openShop: { done: "shopping" },
    shopping: { buy: "buy", close: "closeShop" },
    buy: { done: "shopping" },
    closeShop: { done: "awaitIntent" },
    celebrate: { done: "awaitIntent" },
    deliver: { done: "awaitIntent" }
  }
});

const ward = defineNode({
  rest: true,
  checkpoint: true,
  scene: "ward",
  outcomes: { play: type() }
});
const mainFlow = defineFlow("main", {
  nodes: { ward, board: boardPlay },
  start: "ward",
  outcomes: {},
  edges: { ward: { play: "board" }, board: { left: "ward" } }
});

/**
 * The game, its features with `systemsRun` or without, and the run counts of its systems.
 *
 * @param run - What `board`, `shop`, `ward` and `reward` write under `systemsRun`; `undefined` leaves the key out.
 * @returns The game definition and its run counts.
 */
function scopedGame(run: Flow.SystemsRun | undefined) {
  const runs: Runs = { board: 0, shop: 0, ward: 0, reward: 0 };
  const scoped = run === undefined ? {} : { systemsRun: run };
  const lookOf = (name: keyof Runs, look: typeof BoardLook) =>
    system({
      name: `scoped.${name}`,
      phase: "animate",
      query: [mut(look)],
      run: (rows, { res }) => {
        runs[name] += 1;

        for (const [, value] of rows) value.shade = res(Now).now - START;
      }
    });

  const screens = defineFeature("screens", { flows: [mainFlow], scenes: [wardScene, boardScene] });
  const board = defineFeature("board", {
    flows: [boardPlay],
    projections: [boardItems],
    systems: [lookOf("board", BoardLook)],
    ...scoped
  });
  const shop = defineFeature("shop", {
    projections: [shopSheet],
    systems: [lookOf("shop", ShopLook)],
    ...scoped
  });
  const wardFeature = defineFeature("ward", {
    projections: [wardRoom],
    systems: [lookOf("ward", WardLook)],
    ...scoped
  });
  const reward = defineFeature("reward", {
    ui: [RewardPopup],
    systems: [
      system({
        name: "scoped.reward",
        phase: "animate",
        query: [],
        run: () => {
          runs.reward += 1;
        }
      })
    ],
    ...scoped
  });
  const orders = defineFeature("orders", { nodes: [deliver] });

  const game = defineGameApp({
    flow: mainFlow,
    safeNode: "ward",
    player: { coins: 0 },
    session: { shop: false },
    features: [screens, board, shop, wardFeature, reward, orders]
  });

  return { game, runs };
}

/** The features a trace reads. */
const FEATURES = ["screens", "board", "shop", "ward", "reward", "orders"] as const;

/** The two scene bundles: the ward names one file, so a test can hold its load. */
const manifest: Assets.Manifest = {
  version: 1,
  bundles: {
    ward: {
      feature: "screens",
      tier: "lazy",
      mb: 0,
      files: [{ key: "ward.room", path: "ward/room.png", width: 4, height: 4, mb: 0 }]
    },
    board: { feature: "screens", tier: "lazy", mb: 0, files: [] }
  }
};

/** The file seam: every fetch answers at once, unless the test holds them. */
type HeldIo = { io: Assets.AssetsIo; hold: () => void; release: () => void };

/**
 * A file seam whose fetches the test can hold and release.
 *
 * @returns The seam and its switch.
 */
function heldIo(): HeldIo {
  const gate = { held: false, waiting: [] as Array<() => void> };
  const response = {
    ok: true,
    status: 200,
    // eslint-disable-next-line unicorn/no-null -- a `Response` answers a missing header with null.
    headers: { get: () => null },
    json: () => Promise.resolve({}),
    blob: () => Promise.resolve(new Blob([new Uint8Array(4)])),
    text: () => Promise.resolve(""),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(4))
  };

  return {
    io: {
      fetch: () =>
        gate.held
          ? new Promise(resolve => gate.waiting.push(() => resolve(response)))
          : Promise.resolve(response),
      decode: () => Promise.resolve({ width: 4, height: 4 } as unknown as Assets.DecodedImage),
      createTexture: () => ({ label: "texture" }) as unknown as Assets.Texture,
      sliceTexture: () => ({ label: "slice" }) as unknown as Assets.Texture,
      destroyTexture: () => undefined
    },
    hold: () => {
      gate.held = true;
    },
    release: () => {
      gate.held = false;

      for (const resolve of gate.waiting.splice(0)) resolve();
    }
  };
}

/**
 * Starts the screen app of one variant on the ward.
 *
 * @param run - The variant's `systemsRun`.
 * @returns The app, its seams and its run counts, resting on the ward.
 */
async function startOnWard(run: Flow.SystemsRun | undefined) {
  const { game, runs } = scopedGame(run);
  const files = heldIo();
  const { app, clock } = game.screen({ manifest, io: files.io });

  await app.start();
  app.flow.run().catch(() => undefined);

  /**
   * Steps frames of 16 ms on the fake clock, the runner given its turn before each.
   *
   * @param count - How many.
   * @param each - What runs after each frame.
   */
  const frames = async (count: number, each?: () => void): Promise<void> => {
    for (let frame = 0; frame < count; frame += 1) {
      await tick(80);
      clock.advance(16);
      app.time.step(16);
      each?.();
    }
  };

  await frames(6);
  expect(app.flow.state().path).toBe("ward");

  return { app, runs, files, frames };
}

/** The scripted session: at these frames, these answers. */
const SCRIPT: ReadonlyArray<readonly [number, string]> = [
  [4, "play"],
  [14, "openShop"],
  [24, "buy"],
  [34, "close"],
  [44, "celebrate"],
  [54, "ok"],
  [64, "deliver"],
  [74, "done"],
  [84, "leave"]
];

/** Frames the scripted session runs. */
const SESSION = 110;

/** A started app of one variant. */
type Started = Awaited<ReturnType<typeof startOnWard>>;

/**
 * What every view of the game shows in one frame: each look component's views, by key, with their shade.
 *
 * @param app - The running app.
 * @returns One line.
 */
function looksOf(app: Started["app"]): string {
  const line: string[] = [];

  for (const look of [BoardLook, ShopLook, WardLook]) {
    for (const [entity, value] of app.world.ecs.query(look)) {
      line.push(`${app.world.projection.keyOf(entity)?.key ?? entity}:${value.shade}`);
    }
  }

  return line.join(" ");
}

/**
 * Plays the scripted session on a started app, calling `each` after every frame.
 *
 * @param started - The app on the ward.
 * @param each - Called after every frame.
 */
async function playSession(started: Started, each: () => void): Promise<void> {
  for (let index = 0; index < SESSION; index += 1) {
    for (const [at, intent] of SCRIPT) {
      if (at === index) expect(started.app.flow.gate.answer({ intent })).toBe(true);
    }

    await started.frames(1, each);
  }
}

/**
 * Plays the scripted session on a fresh app of one variant and keeps what every view shows in every frame.
 *
 * @param run - The variant's `systemsRun`.
 * @returns One line of looks per frame.
 */
async function looksOfSession(run: Flow.SystemsRun | undefined): Promise<string[]> {
  const started = await startOnWard(run);
  const seen: string[] = [];

  await playSession(started, () => seen.push(looksOf(started.app)));
  await started.app.stop();

  return seen;
}

/**
 * Plays the scripted session on a fresh scoped app and keeps, in every phase of every frame, which features are
 * active: a system of each phase that always runs reads it.
 *
 * @returns One line per phase run: the phase and a flag per feature.
 */
async function activeOfSession(): Promise<string[]> {
  const started = await startOnWard("active");
  const seen: string[] = [];
  const ecs = started.app.world.ecs;

  for (const phase of ["input", "animate", "layout", "sync"] as const) {
    ecs.system(
      system({
        name: `trace.${phase}`,
        phase,
        query: [],
        run: () => {
          seen.push(`${phase} ${FEATURES.map(name => (ecs.isActive(name) ? 1 : 0)).join("")}`);
        }
      })
    );
  }

  await playSession(started, () => undefined);
  await started.app.stop();

  return seen;
}

describe("systems that run where their feature is", () => {
  // Bug caught: the board's systems stop the moment its node leaves the stack, while its scene is still drawn
  // during the ward's load (a frozen look), or they keep running on the ward.
  it("the board's systems run on the board, while the board scene is still shown after its node left, and not on the ward", async () => {
    const { app, runs, files, frames } = await startOnWard("active");

    expect(app.world.ecs.isActive("board")).toBe(false);
    expect(runs.board).toBe(0);
    expect(runs.ward).toBeGreaterThan(0);

    app.flow.gate.answer({ intent: "play" });
    await frames(6);

    expect(app.scenes.current()).toBe("board");
    expect(app.world.ecs.isActive("board")).toBe(true);
    expect(app.world.ecs.isActive("ward")).toBe(false);
    expect(runs.board).toBeGreaterThan(0);

    const wardRuns = runs.ward;

    // The ward's file is fetched again on the way back, and the test holds it.
    app.assets.unload("ward");
    files.hold();
    app.flow.gate.answer({ intent: "leave" });
    await frames(4);

    expect(app.flow.state().path).toBe("ward");
    expect(app.scenes.current()).toBe("board");
    expect(app.world.ecs.isActive("board")).toBe(true);

    const whileLoading = runs.board;

    await frames(3);

    expect(runs.board).toBe(whileLoading + 3);
    expect(runs.ward).toBe(wardRuns);

    files.release();
    await frames(1);

    expect(app.scenes.current()).toBe("ward");

    await frames(1);

    const stopped = runs.board;

    expect(app.world.ecs.isActive("board")).toBe(false);
    expect(app.world.ecs.isActive("ward")).toBe(true);

    await frames(5);

    expect(runs.board).toBe(stopped);

    await app.stop();
  });

  // Bug caught: a system skipped while its feature's views are shown, a frozen or missing look (the K invariant).
  it("a scoped feature's views look the same in every frame as under always", async () => {
    const always = await looksOfSession(undefined);
    const scoped = await looksOfSession("active");

    expect(scoped).toEqual(always);
    expect(always.some(line => line.includes("sheet:"))).toBe(true);
    expect(always.some(line => line.includes("room:"))).toBe(true);
  });

  // Bug caught: the active set depends on something else than the session (an order of a map, a wall clock).
  it("two runs of the same session decide the same active features in every phase", async () => {
    const first = await activeOfSession();
    const second = await activeOfSession();

    expect(second).toEqual(first);
    expect(new Set(first.map(line => line.slice(-6))).size).toBeGreaterThan(3);
  });

  // Bug caught: systemsRun leaks into the logic set, so the headless walk or the graph hash (and every
  // bookmark) changes when a game scopes its systems.
  it("the headless app of a game with scoped features walks to the same results and the same graph hash", async () => {
    const route: Flow.RouteStep[] = [
      { at: "ward", intent: "play" },
      { at: "board/awaitIntent", intent: "openShop" },
      { at: "board/shopping", intent: "buy" },
      { at: "board/shopping", intent: "close" },
      { at: "board/awaitIntent", intent: "leave" }
    ];
    const walkOf = async (run: Flow.SystemsRun | undefined) => {
      const { app } = scopedGame(run).game.headless();

      await app.start();
      app.flow.run().catch(() => undefined);
      await tick(80);

      const state = await app.flow.walk(route);
      const result = { path: state.path, player: app.model.store.snapshot().player };
      const hash = graphHash(app.flow.describe());

      await app.stop();

      return { result, hash };
    };

    const always = await walkOf(undefined);
    const scoped = await walkOf("active");

    expect(scoped).toEqual(always);
    expect(scoped.result).toEqual({ path: "ward", player: { coins: 1 } });
  });

  // Bug caught: the owner of a node is taken from its flow, so the board's feature runs for a node `orders` lists,
  // or `orders` keeps running after its node left.
  it("a feature of a contributed node stays active only while its node is on the stack", async () => {
    const { app, frames } = await startOnWard("active");

    app.flow.gate.answer({ intent: "play" });
    await frames(4);

    expect(app.world.ecs.isActive("orders")).toBe(false);

    app.flow.gate.answer({ intent: "deliver" });
    await frames(2);

    expect(app.flow.state().path).toBe("board/deliver");
    expect(app.world.ecs.isActive("orders")).toBe(true);

    app.flow.gate.answer({ intent: "done" });
    await frames(2);

    expect(app.flow.state().path).toBe("board/awaitIntent");
    expect(app.world.ecs.isActive("orders")).toBe(false);

    await app.stop();
  });
});
