/**
 * @file ui plugin — the app of the scale files of change 2026-11-26-hot-path-research. Not a test file. An app of
 * its own with the album sheet at three sizes (572, 1 180 and 1 960 elements) and an event popup of 150 elements.
 * Real flow, world, anim, text and Yoga; inert renderer, headless: what a frame costs the engine before Pixi.
 * A step is a whole frame of the app (`time.step`), and the world's timing table says what each system took.
 */
import { vi } from "vitest";
import { createApp, defineGame, projection, type } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import { i18nPlugin } from "../../../i18n";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { worldPlugin } from "../../../world";
import { Tree } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { UiCounters } from "../../components";
import { uiPlugin } from "../../index";
import type { DescriptionNode } from "../../jsx/types";
import { ALBUMS, POPUP, SIZES, WALK } from "./stress";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** One root of a single-root projection. */
type Item = { id: string };

const home = defineNode({ rest: true, outcomes: { tick: type() } });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: { tick: "home" } }
});

/** The album roots, one per size, each mounted by the file that measures it. */
const albums = SIZES.map(size =>
  projection({
    name: size.name,
    layer: "ui",
    from: (): Item => ({ id: size.name }),
    view: () => ALBUMS[size.name]?.peek[0] as DescriptionNode
  })
);

/** The event popup, mounted and unmounted by an open and a close. */
const popup = projection({
  name: "popup",
  layer: "ui",
  from: (): Item => ({ id: "popup" }),
  view: () => POPUP
});

const stressFeature = defineFeature("stress", {
  flows: [main],
  projections: [...albums, popup]
});

/** The patch that only marks the root's `Tree` changed: its node was written in place. */
const NO_PATCH: object = Object.freeze({});

/** Frames that bring the enter motions of a root to rest. */
const SETTLE_FRAMES = 60;

/** The owner of what the fixture mounts. */
const OWNER = { kind: "plugin", name: "stress" } as const;

/** The started app with one album at rest, and its steps. Every step is one whole frame of the app. */
export type StressPerf = {
  /** The Yoga nodes the album root made: its elements. */
  elements: number;
  /** One turn or its way back: the two pages of the strip swap places. Mounts and drops nothing. */
  turn: () => void;
  /** The next step of the swipe: a peek mounts a page and drops one, a turn swaps the two. */
  swipe: () => void;
  /** Whether the last `swipe` was a peek. */
  peeked: () => boolean;
  /** A frame in which nothing changed. */
  still: () => void;
  /** Opens the popup over the album, or closes it: a mount or an unmount of its 150 elements. */
  popup: () => void;
  /** The world's timing table of the last frame: a name and its ms per system. */
  systems: () => { names: readonly string[]; ms: Float64Array };
  stop: () => Promise<void>;
};

/**
 * Starts the app of the scale files and mounts the album of one size.
 *
 * @param name - The album's projection: `album572`, `album1180` or `album1960`.
 * @param agent - Whether the app runs as an agent build, with the timing table `split` reads.
 * @returns The app's steps.
 */
export async function startStress(name: string, agent = true): Promise<StressPerf> {
  // An agent build keeps the per-system timing table; a release build has none, and its bytes are the game's.
  if (agent) vi.stubGlobal("__MOKU_GAME_AGENT__", true);

  const album = ALBUMS[name];

  if (album === undefined) throw new Error(`perf: no album ${name}`);

  const app = createApp({
    plugins: [
      worldPlugin,
      rendererPlugin,
      inputPlugin,
      assetsPlugin,
      scenesPlugin,
      animPlugin,
      i18nPlugin,
      textPlugin,
      uiPlugin,
      stressFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: {}, initialSession: {}, seed: 1 }
    }
  });

  vi.spyOn(app.renderer.host, "kind").mockReturnValue("webgpu");
  await app.start();
  vi.restoreAllMocks();
  app.flow.run().catch(() => undefined);

  for (let index = 0; index < 60; index += 1) await Promise.resolve();

  const ecs = app.world.ecs;
  const projections = app.world.projection;
  const counters = ecs.resource(UiCounters);
  const before = counters.nodes;

  projections.setLayers([{ name: "ui", sort: "order" }]);
  projections.mount([name], OWNER);

  for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) app.time.step(16);

  const elements = counters.nodes - before;
  let root: Entity | undefined;

  for (const [entity] of ecs.query(Tree)) {
    if (ecs.get(entity, Tree)?.node === album.peek[0]) root = entity;
  }

  if (root === undefined) throw new Error("perf: the album root was not mounted");

  const entity = root;
  const tree = ecs.get(entity, Tree) as { node: DescriptionNode };
  const render = (node: DescriptionNode): void => {
    tree.node = node;
    ecs.set(entity, Tree, NO_PATCH);
  };
  const at = new Int32Array(3);

  return {
    elements,
    turn: (): void => {
      at[0] = at[0] === 0 ? 1 : 0;
      render((at[0] === 1 ? album.turned[0] : album.peek[0]) as DescriptionNode);
      app.time.step(16);
    },
    swipe: (): void => {
      const step = ((at[1] ?? 0) + 1) % (2 * WALK);
      const set = step >> 1;

      at[1] = step;
      render((step % 2 === 0 ? album.peek[set] : album.turned[set]) as DescriptionNode);
      app.time.step(16);
    },
    peeked: (): boolean => (at[1] ?? 0) % 2 === 0,
    still: (): void => {
      app.time.step(16);
    },
    popup: (): void => {
      at[2] = at[2] === 0 ? 1 : 0;

      if (at[2] === 1) projections.mount(["popup"], OWNER);
      else projections.unmount(["popup"]);

      app.time.step(16);
    },
    systems: () => {
      const timing = app.world.systemTimes();

      if (timing === undefined) throw new Error("perf: no timing table");

      return timing;
    },
    stop: async (): Promise<void> => {
      await app.stop();
      vi.unstubAllGlobals();
    }
  };
}

/**
 * Runs a step `runs` times and gives the median ms of each system of the world, and of the whole step.
 *
 * @param perf - The started app.
 * @param step - The step.
 * @param runs - How many times.
 * @param only - Keeps a run when it answers true, asked right after the step; every run by default.
 * @returns The medians by system name, `frame` for the whole step.
 */
export function split(
  perf: StressPerf,
  step: () => void,
  runs: number,
  only: () => boolean = () => true
): Record<string, number> {
  const samples = new Map<string, number[]>();
  const push = (name: string, ms: number): void => {
    const list = samples.get(name) ?? [];

    list.push(ms);
    samples.set(name, list);
  };

  for (let warm = 0; warm < 200; warm += 1) step();

  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();

    step();

    const took = performance.now() - start;

    if (!only()) continue;

    const timing = perf.systems();

    push("frame", took);
    for (const [index, name] of timing.names.entries()) push(name, timing.ms[index] ?? 0);
  }

  const medians: Record<string, number> = {};

  for (const [name, list] of samples) {
    list.sort((left, right) => left - right);
    medians[name] = Math.round((list[list.length >> 1] ?? 0) * 1000) / 1000;
  }

  return medians;
}
