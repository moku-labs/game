/**
 * @file Root integration — when a system runs. A system with a query runs while its query has an entity; a system
 * with `scenes` runs while one of them is mounted or leaving. A small game on the screen set, no canvas, a fake
 * clock, shaped as A Memory Missing's three hard cases: `screens` declares the ward and the board and owns the main
 * flow; `board` owns the board's sub-flow, its items and its JSX root, which leaves with a motion of 160 ms after the
 * switch to the ward; `orders` owns one node and the component its cards carry inside the board's root (no scene,
 * no view of its own); `story` owns a component the ward's room carries (no node, no scene, no view). Cross-plugin:
 * flow (the walk), world (the skip), scenes (`setScene`), ui (the root's elements and their exit), anim (the motion).
 */
import type { Assets } from "@moku-labs/game";
import {
  component,
  defineGame,
  defineMotion,
  defineScene,
  exit,
  mut,
  projection,
  system,
  Transform,
  type
} from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { describe, expect, it } from "vitest";
import { tick } from "./helpers";

type Player = { coins: number };
type Session = Record<string, never>;

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, never>;
}>();

/** The look the board writes on its items. */
const BoardLook = component("scoped.boardLook", { shade: 0 });
/** The look the ward writes on its room. */
const WardLook = component("scoped.wardLook", { shade: 0 });
/** What `orders` puts on the cards it shows inside the board's root. */
const OrderCard = component("scoped.orderCard", { seen: false });
/** What the board puts on its root's panel, which leaves with a motion. */
const BoardLeave = component("scoped.boardLeave", { left: 0 });
/** What `story` reads off the ward's room: where the sweep stands. */
const SweepAnchor = component("scoped.sweepAnchor", { zone: "" });

/** One row of a projection. */
type Row = { id: string };

/** The board's root leaves as A Memory Missing's does: it grows to 105 % for 160 ms. */
const grow = defineMotion({
  states: { gone: { Transform: { scale: 1.05 } } },
  transition: { ms: 160 },
  on: { exit: "gone" }
});

/** The board's two items. */
const boardItems = projection({
  name: "board.items",
  layer: "cells",
  from: (): Row[] => [{ id: "a" }, { id: "b" }],
  key: (row: Row) => row.id,
  view: () => [BoardLook(), Transform()]
});

/** The board's JSX root: a panel that leaves with `grow`, and two order cards inside it. */
const boardRoot = projection({
  name: "board.root",
  layer: "cells",
  from: () => ({ id: "root" }),
  view: () => (
    <stack
      key="boardPanel"
      motion={grow}
      components={[BoardLeave()]}
      style={{ width: 1080, height: 1920 }}
    >
      <stack key="card1" components={[OrderCard()]} style={{ width: 200, height: 200 }} />
      <stack key="card2" components={[OrderCard()]} style={{ width: 200, height: 200 }} />
    </stack>
  )
});

/** The ward's room: the hub `story` reads its anchor from. */
const wardRoom = projection({
  name: "ward.room",
  layer: "room",
  from: (): Row[] => [{ id: "room" }],
  key: (row: Row) => row.id,
  view: () => [WardLook(), SweepAnchor({ zone: "hall" }), Transform()]
});

const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { room: {} },
  projections: [wardRoom]
});
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [boardItems, boardRoot]
});

const awaitIntent = defineNode({
  rest: true,
  scene: "board",
  outcomes: { deliver: type(), leave: type() }
});
/** A node of the board's flow that `orders` lists: `orders` owns it, not `board`. */
const deliver = defineNode({ rest: true, outcomes: { done: type() } });

const boardPlay = defineFlow("boardPlay", {
  nodes: { awaitIntent, deliver },
  start: "awaitIntent",
  outcomes: { left: type() },
  edges: {
    awaitIntent: { deliver: "deliver", leave: exit("left") },
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

/** What every system saw: its runs, `resumed` of each, and the scene mounted at each run. */
type Seen = { runs: number; resumed: boolean[]; scenes: string[] };

/** The systems the test watches, by name. */
type Watched =
  | "board.look"
  | "ward.look"
  | "orders.cards"
  | "board.leave"
  | "board.shade"
  | "story.sweep";

/**
 * The game and what its systems saw.
 *
 * @returns The game definition and the record of its systems.
 */
function watchedGame() {
  const seen = {} as Record<Watched, Seen>;
  const scene = { current: (): string => "" };

  /**
   * Records one run of a watched system.
   *
   * @param name - The system.
   * @param resumed - Its `resumed`.
   */
  const record = (name: Watched, resumed: boolean): void => {
    seen[name] ??= { runs: 0, resumed: [], scenes: [] };
    seen[name].runs += 1;
    seen[name].resumed.push(resumed);
    seen[name].scenes.push(scene.current());
  };

  const boardLook = system({
    name: "board.look",
    phase: "animate",
    query: [mut(BoardLook)],
    run: (rows, { resumed }) => {
      record("board.look", resumed);
      for (const [, look] of rows) look.shade += 1;
    }
  });
  const wardLook = system({
    name: "ward.look",
    phase: "animate",
    query: [mut(WardLook)],
    run: (rows, { resumed }) => {
      record("ward.look", resumed);
      for (const [, look] of rows) look.shade += 1;
    }
  });
  const boardLeave = system({
    name: "board.leave",
    phase: "animate",
    query: [BoardLeave],
    run: (_rows, { resumed }) => record("board.leave", resumed)
  });
  // Every view carries Transform, on every screen: only `scenes` keeps it to the board.
  const boardShade = system({
    name: "board.shade",
    phase: "sync",
    query: [Transform],
    scenes: ["board"],
    run: (_rows, { resumed }) => record("board.shade", resumed)
  });
  const orderCards = system({
    name: "orders.cards",
    phase: "sync",
    query: [OrderCard],
    run: (_rows, { resumed }) => record("orders.cards", resumed)
  });
  const storySweep = system({
    name: "story.sweep",
    phase: "sync",
    query: [SweepAnchor, Transform],
    run: (_rows, { resumed }) => record("story.sweep", resumed)
  });

  const screens = defineFeature("screens", { flows: [mainFlow], scenes: [wardScene, boardScene] });
  const board = defineFeature("board", {
    flows: [boardPlay],
    projections: [boardItems, boardRoot],
    components: [BoardLook, BoardLeave],
    systems: [boardLook, boardLeave, boardShade]
  });
  const wardFeature = defineFeature("ward", {
    projections: [wardRoom],
    components: [WardLook],
    systems: [wardLook]
  });
  const orders = defineFeature("orders", {
    nodes: [deliver],
    components: [OrderCard],
    systems: [orderCards]
  });
  const story = defineFeature("story", { components: [SweepAnchor], systems: [storySweep] });

  const game = defineGameApp({
    flow: mainFlow,
    safeNode: "ward",
    player: { coins: 0 },
    session: {},
    features: [screens, board, wardFeature, orders, story]
  });

  return { game, seen, scene };
}

/** The two scene bundles, with no files to fetch. */
const manifest: Assets.Manifest = {
  version: 1,
  bundles: {
    ward: { feature: "screens", tier: "lazy", mb: 0, files: [] },
    board: { feature: "screens", tier: "lazy", mb: 0, files: [] }
  }
};

/** What every fetch of the file seam answers. */
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

/** The file seam: every fetch answers at once. */
const io: Assets.AssetsIo = {
  fetch: () => Promise.resolve(response),
  decode: () => Promise.resolve({ width: 4, height: 4 } as unknown as Assets.DecodedImage),
  createTexture: () => ({ label: "texture" }) as unknown as Assets.Texture,
  sliceTexture: () => ({ label: "slice" }) as unknown as Assets.Texture,
  destroyTexture: () => undefined
};

/**
 * Starts the screen app on the ward.
 *
 * @returns The app, what its systems saw and a frame driver, resting on the ward.
 */
async function startOnWard() {
  const { game, seen, scene } = watchedGame();
  const { app, clock } = game.screen({ manifest, io });

  scene.current = () => app.scenes.current() ?? "";
  await app.start();
  app.flow.run().catch(() => undefined);

  /**
   * Steps frames of 16 ms on the fake clock, the runner given its turn before each.
   *
   * @param count - How many.
   */
  const frames = async (count: number): Promise<void> => {
    for (let frame = 0; frame < count; frame += 1) {
      await tick(80);
      clock.advance(16);
      app.time.step(16);
    }
  };

  /**
   * The runs of one system so far.
   *
   * @param name - The system.
   * @returns How often it ran.
   */
  const runs = (name: Watched): number => seen[name]?.runs ?? 0;

  await frames(6);
  expect(app.flow.state().path).toBe("ward");

  return { app, seen, frames, runs };
}

/** Frames the board's root needs to play its exit of 160 ms, and more. */
const SETTLED = 20;

describe("when a system runs", () => {
  // Bug caught: a system runs over a screen that has nothing for it (the board's look on the ward), or does not run
  // once its entities came, or does not know it slept.
  it("runs while its query has an entity: the board's look on the board, not on the ward", async () => {
    const { app, seen, frames, runs } = await startOnWard();

    expect(runs("ward.look")).toBeGreaterThan(0);
    expect(runs("board.look")).toBe(0);

    app.flow.gate.answer({ intent: "play" });
    await frames(6);

    expect(app.scenes.current()).toBe("board");
    expect(runs("board.look")).toBeGreaterThan(0);
    expect(seen["board.look"].resumed[0]).toBe(true);
    expect(seen["board.look"].resumed.slice(1).every(resumed => !resumed)).toBe(true);

    const wardRuns = runs("ward.look");

    await frames(4);

    expect(runs("ward.look")).toBe(wardRuns);

    await app.stop();
  });

  // Bug caught (A Memory Missing, orders): a feature whose only presence is a component on the elements of another
  // feature's JSX root never runs its system, or keeps running after those elements left.
  it("runs a system over the cards of one feature inside another feature's root while they stand", async () => {
    const { app, frames, runs } = await startOnWard();

    expect(runs("orders.cards")).toBe(0);

    app.flow.gate.answer({ intent: "play" });
    await frames(4);

    const onBoard = runs("orders.cards");

    expect(onBoard).toBeGreaterThan(0);

    app.flow.gate.answer({ intent: "deliver" });
    await frames(3);
    app.flow.gate.answer({ intent: "done" });
    await frames(3);

    expect(app.flow.state().path).toBe("board/awaitIntent");
    expect(runs("orders.cards")).toBe(onBoard + 6);

    app.flow.gate.answer({ intent: "leave" });
    await frames(SETTLED);

    const after = runs("orders.cards");

    await frames(5);

    expect(app.scenes.current()).toBe("ward");
    expect(runs("orders.cards")).toBe(after);

    await app.stop();
  });

  // Bug caught (A Memory Missing, board): the board's systems stop at the switch, so its leaving root freezes under
  // the ward; or a system with scenes: ["board"] runs on for good.
  it("drives the board's leaving root after the switch to the ward, until its exit ended", async () => {
    const { app, seen, frames, runs } = await startOnWard();

    expect(runs("board.shade")).toBe(0);

    app.flow.gate.answer({ intent: "play" });
    await frames(4);

    expect(runs("board.leave")).toBeGreaterThan(0);
    expect(runs("board.shade")).toBeGreaterThan(0);

    app.flow.gate.answer({ intent: "leave" });
    await frames(SETTLED);

    expect(app.scenes.current()).toBe("ward");
    expect(seen["board.leave"].scenes).toContain("ward");
    expect(seen["board.shade"].scenes).toContain("ward");

    const leave = runs("board.leave");
    const shade = runs("board.shade");

    await frames(5);

    expect(runs("board.leave")).toBe(leave);
    expect(runs("board.shade")).toBe(shade);

    await app.stop();
  });

  // Bug caught (A Memory Missing, story): a system of a feature with no node, scene or view waits for its feature to
  // show something, so the hub's anchors are never read on the ward.
  it("runs a system over a component another feature's view carries, as soon as that view stands", async () => {
    const { app, seen, frames, runs } = await startOnWard();

    expect(runs("story.sweep")).toBeGreaterThan(0);
    expect(seen["story.sweep"].scenes.every(scene => scene === "ward")).toBe(true);

    app.flow.gate.answer({ intent: "play" });
    await frames(4);

    const onBoard = runs("story.sweep");

    await frames(4);

    expect(runs("story.sweep")).toBe(onBoard);

    await app.stop();
  });
});
