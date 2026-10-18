/**
 * @file renderer — the fixtures of the perf files: an agent build whose page clock is a plain function, a steady frame
 * record, and a started renderer with a layer of sprite views. Not a test file. Every fixture is built outside the
 * measured window; what a window calls allocates only what the engine allocates.
 */
import * as pixi from "pixi.js";
import { vi } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import type { FrameMeasure } from "../../../time/types";
import { Layer } from "../../../world/ecs/define";
import type { Entity, SystemTiming } from "../../../world/types";
import {
  HudPart,
  Sprite,
  type SpriteValue,
  Transform,
  type TransformValue
} from "../../components";
import { commitFrame } from "../../monitor/commit";
import type { PixiFilter } from "../../types";
import { FakeFilter, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";
import { startOverlayStage } from "../overlay-harness";
import { type AgentRenderer, startAgent } from "../perf-harness";

/** The owner of every entity the fixtures spawn. */
const OWNER = { kind: "plugin", name: "perf" } as const;

/** The page clock between two frames at 120 Hz, ms. */
export const FRAME_MS = 8.33;

/** Calls before a window: the engine's code reaches its optimized tier first, as on a phone after a few seconds. */
const WARM_CALLS = 30_000;

/**
 * Calls of a window, ten times `alloc`'s default: a stray compile of a few kilobytes inside it weighs a tenth of a byte
 * a call, so the two halves of `alloc`'s cross-check still agree on a step that keeps 0 B.
 */
const CALLS = 100_000;

/**
 * The heap bytes one call of a step keeps: the step run until V8 optimized what it calls, outside the window, then
 * `alloc` over a window of `calls`.
 *
 * @param fn - The step.
 * @param calls - Calls of the window; fewer for a step that allocates kilobytes, so the window stays in the young
 *   generation.
 * @returns Bytes per call.
 */
export function bytesPerCall(fn: () => void, calls = CALLS): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, calls);
}

/**
 * Starts an agent build whose page clock is a plain function that moves on by 1 ms at every read: the harness's spy
 * records every call, which a window would count, and Node's own clock allocates at every read. Whole milliseconds are
 * small integers, which a call hands back unboxed, so a window counts the engine's bytes alone (a browser's clock may
 * box its answer: that is the platform's). A bench keeps the real clock instead: it times its runs with it. Thirty
 * world systems are timed, as on the ward of A Memory Missing.
 *
 * @param clock - `"plain"` for an alloc window, `"real"` for a bench.
 * @returns The started agent build.
 */
export async function startPlainAgent(clock: "plain" | "real" = "plain"): Promise<AgentRenderer> {
  const agent = await startAgent({ scene: { passes: 2, batches: 2, draws: 1 } });
  const page = agent.clock;

  vi.restoreAllMocks();
  if (clock === "plain") {
    globalThis.performance.now = (): number => {
      page.now += 1;

      return page.now;
    };
  }
  agent.mock.setSystemTimes(systemTiming(30));

  return agent;
}

/**
 * A timing table of `count` systems, each with a few hundredths of a millisecond.
 *
 * @param count - The systems.
 * @returns The table.
 */
function systemTiming(count: number): SystemTiming {
  return {
    clock: () => 0,
    names: Array.from({ length: count }, (_name, index) => `system.${index}`),
    ms: Float64Array.from({ length: count }, (_ms, index) => 0.01 + (index % 7) * 0.013)
  };
}

/**
 * One reused frame record of a steady 120 Hz frame, as `time` hands its listeners: the caller moves `frame` on. The
 * page clock is held inside one second, so no flush runs in a window.
 *
 * @param gapMs - The gap since the last frame: 8.3 for a steady frame, 30 for a late one.
 * @returns The record.
 */
export function steadyFrame(gapMs = 8.3): FrameMeasure {
  return {
    frame: 1,
    at: 500.5,
    gapMs,
    capMs: FRAME_MS,
    rateMs: FRAME_MS,
    displayMs: FRAME_MS,
    skipped: 0,
    startMs: 0.1,
    phaseMs: Float32Array.of(0.2, 0.1, 0.1, 0.4, 0.1, 1),
    workMs: 2.5,
    listenersMs: 0.05,
    idle: false,
    stepped: false
  };
}

/**
 * One frame of the monitor of an agent build, as the frame drives it: the window opens at the frame's start on the
 * `clock` the counters read, the frame ends drawn after its work, the record is committed and its frame number moves
 * on. The clock moves 8.33 ms a frame, so the window's times are fractions, as on a phone.
 *
 * @param agent - The started agent build.
 * @param record - The frame record.
 */
export function monitorFrame(agent: AgentRenderer, record: FrameMeasure): void {
  const { mock, pc } = agent;

  mock.setNow(record.frame * FRAME_MS);
  mock.modules.monitor.begin();
  mock.setNow(record.frame * FRAME_MS + record.workMs);
  mock.modules.monitor.end(true);
  commitFrame(pc, record);
  record.frame += 1;
}

/** A started renderer with `count` sprite views in one layer, every change set cleared. */
export type SpriteStage = {
  mock: MockRenderer;
  entities: Entity[];
};

/**
 * Starts the mock renderer (no agent flag: a release build's pass) with `count` sprites of a 64 x 64 texture in the
 * layer `items`, each 64 x 64 at its own place, and runs the pass that builds them.
 *
 * @param count - The sprites.
 * @param onDemand - `renderer.onDemand`: a frame is drawn only for a reason.
 * @returns The stage.
 */
export async function startSprites(count: number, onDemand = false): Promise<SpriteStage> {
  const mock = createMockRenderer({ config: { onDemand } });
  const texture = new FakeTexture({ source: { width: 64, height: 64, destroyed: false } });

  await mock.start();
  mock.api.sync.textures.provide(() => texture as never);
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  const entities: Entity[] = [];

  for (let index = 0; index < count; index += 1) {
    entities.push(
      mock.world.ecs.spawn(OWNER, [
        Layer({ name: "items" }),
        Transform({ x: (index % 20) * 50, y: Math.floor(index / 20) * 50 }),
        Sprite({ texture: "board.cell", width: 64, height: 64 })
      ])
    );
  }

  mock.modules.sync.pass();
  mock.world.clearChanges();

  return { mock, entities };
}

/**
 * The stored `Transform` of an entity, writable: a window moves it in place, so the world's own `set` (its change
 * marks) stays out of the bytes the renderer is measured by. The entity's change mark is made once, by the caller.
 *
 * @param mock - The started renderer.
 * @param entity - The entity.
 * @returns The value the world holds.
 */
export function storedTransform(mock: MockRenderer, entity: Entity): TransformValue {
  const value = mock.world.ecs.get(entity, Transform);

  if (value === undefined) throw new Error("perf fixture: the entity has no Transform");

  return value as TransformValue;
}

/**
 * The stored `Sprite` of an entity, writable, as `storedTransform`.
 *
 * @param mock - The started renderer.
 * @param entity - The entity.
 * @returns The value the world holds.
 */
export function storedSprite(mock: MockRenderer, entity: Entity): SpriteValue {
  const value = mock.world.ecs.get(entity, Sprite);

  if (value === undefined) throw new Error("perf fixture: the entity has no Sprite");

  return value as SpriteValue;
}

/**
 * One frame of change marks: `count` views of a 20-sprite stage marked (every other one a move, the rest what it
 * draws), then the render phase's decision, which empties the marks.
 *
 * @param count - The views marked a frame, at most 20.
 * @param onDemand - `renderer.onDemand`: each mark is judged for the decision.
 * @returns The step.
 */
export async function markedFrame(count: number, onDemand: boolean): Promise<() => void> {
  const { mock, entities } = await startSprites(20, onDemand);
  const { demand } = mock.modules;
  const moves = entities.slice(0, count).filter((_entity, index) => index % 2 === 0);
  const looks = entities.slice(0, count).filter((_entity, index) => index % 2 === 1);

  return () => {
    for (const entity of moves) demand.markMoved(entity);
    for (const entity of looks) demand.mark(entity);

    demand.decide(false);
  };
}

/**
 * A still stage of 12 filtered sprites among 40, as the ward of A Memory Missing: each carries one filter of one apply,
 * hung through the seam `effects` uses. The pass that builds them has run, every change set is cleared.
 *
 * @param enabled - False for filters switched off, as the press dims of the A26 board's buttons wait.
 * @returns The started renderer.
 */
export async function filteredStage(enabled = true): Promise<MockRenderer> {
  const { mock, entities } = await startSprites(40);

  for (let index = 0; index < 12; index += 1) {
    const entity = entities[index * 3] ?? 0;
    const fake = new FakeFilter();

    fake.enabled = enabled;

    const filter = fake as unknown as PixiFilter;

    mock.api.sync.filters.set(entity, [{ filter, passes: 1, kind: "fog" }]);
  }

  mock.modules.sync.pass();
  mock.world.clearChanges();

  return mock;
}

/**
 * A still stage with a HUD: the layers `scene` and `hud` (above the overlays), 20 sprites in the scene and 5 HUD parts
 * in the HUD layer, no overlay open. The pass that builds them has run, every change set is cleared.
 *
 * @returns The started renderer.
 */
export async function hudStage(): Promise<MockRenderer> {
  const mock = createMockRenderer();
  const texture = new FakeTexture({ source: { width: 64, height: 64, destroyed: false } });

  await mock.start();
  mock.api.sync.textures.provide(() => texture as never);
  mock.world.projection.setLayers([
    { name: "scene", sort: "none" },
    { name: "hud", sort: "none", above: "overlays" }
  ]);

  for (let index = 0; index < 20; index += 1) {
    mock.world.ecs.spawn(OWNER, [
      Layer({ name: "scene" }),
      Transform({ x: index * 50 }),
      Sprite({ texture: "board.cell" })
    ]);
  }

  for (let index = 0; index < 5; index += 1) {
    mock.world.ecs.spawn(OWNER, [
      Layer({ name: "hud" }),
      Transform({ x: index * 100 }),
      Sprite({ texture: "board.cell" }),
      HudPart({ key: `part${index}` })
    ]);
  }

  mock.modules.sync.pass();
  mock.modules.sync.stepOverlays();
  mock.world.clearChanges();

  return mock;
}

/** What an endless loop hands `loopsHeld`: what it writes that could show its view again. */
type Reveals = "alpha" | "place" | "both" | undefined;

/**
 * A still board of the A26 kind for the unseen walk (E4), over the real Pixi of the overlay stage: 4 views at alpha 0,
 * 4 under a panel at alpha 0, 4 leaves wholly off the screen, 4 shown views with a filter of padding 8 and 4 shown
 * plain. A frame asks for every view what two endless loops of it ask, one writing its place and one its alpha, then
 * runs the sync pass of a still frame. The frames that build it have run. On a moving board the tree's version moves on
 * before the asks, as a pass that moved a view elsewhere moves it, so every view is walked again.
 *
 * @param moving - True for a board where something else moves every frame.
 * @returns One frame: the asks of the loops and the still pass.
 */
export async function unseenBoard(moving = false): Promise<() => void> {
  const stage = await startOverlayStage();
  const { sync } = stage.drawn.mock.modules;
  const state = stage.drawn.mock.ctx.state.sync;
  const asked: Entity[] = [];
  const panel = stage.view({ order: 1, w: 600, h: 600, alpha: 0 });

  for (let index = 0; index < 4; index += 1) {
    // At alpha 0, under the panel at alpha 0, off the screen, lit (its filter comes below), plain.
    asked.push(
      stage.view({ order: 1, x: index * 120, y: 100, alpha: 0 }),
      stage.view({ parent: panel, x: index * 120, w: 40, h: 40 }),
      stage.view({ order: 1, x: 5000 + index * 120, y: 300 }),
      stage.view({ order: 1, x: index * 120, y: 500 }),
      stage.view({ order: 1, x: index * 120, y: 700 })
    );
  }

  // The views are built first: `effects` hangs its filters on a view that exists, in a frozen list.
  stage.frame();

  for (let index = 3; index < asked.length; index += 5) {
    const glow = new pixi.AlphaFilter();

    glow.padding = 8;
    sync.filters.set(
      asked[index] ?? 0,
      Object.freeze([{ filter: glow as unknown as PixiFilter, passes: 1 }])
    );
  }

  stage.frames(2);

  const reveals: readonly Reveals[] = ["place", "alpha"];

  return () => {
    if (moving) state.passesVersion += 1;

    for (const entity of asked) {
      for (const reveal of reveals) sync.loopsHeld(entity, reveal);
    }

    sync.pass();
  };
}

/** A started kept board: the stage, its kept views with their alpha filters, and a view that is no kept one. */
type KeptBoard = {
  stage: Awaited<ReturnType<typeof startOverlayStage>>;
  views: Entity[];
  filters: InstanceType<typeof pixi.AlphaFilter>[];
  other: Entity;
};

/**
 * Starts a board of `count` views, each with one alpha filter the cache may keep in a frozen list as `effects` hands
 * it over, run until every view is drawn from its picture, and one plain view elsewhere.
 *
 * @param count - The kept views.
 * @returns The board.
 */
async function startKeptBoard(count: number): Promise<KeptBoard> {
  const stage = await startOverlayStage({ onDemand: false });
  const { sync } = stage.drawn.mock.modules;
  const other = stage.view({ order: 1, x: 900, y: 1500 });
  const views: Entity[] = [];
  const filters: InstanceType<typeof pixi.AlphaFilter>[] = [];

  for (let index = 0; index < count; index += 1) {
    views.push(stage.view({ order: 1, x: (index % 5) * 200, y: Math.floor(index / 5) * 200 }));
  }

  // The views are built first: `effects` hangs its filters on a view that exists.
  stage.frame();

  for (const view of views) {
    const filter = new pixi.AlphaFilter();

    filters.push(filter);
    // Frozen, as `effects` hands its lists over.
    sync.filters.set(
      view,
      Object.freeze([
        { filter: filter as unknown as PixiFilter, passes: 1, cache: "local" as const }
      ])
    );
  }

  stage.frames(8);

  const records = stage.drawn.mock.ctx.state.kept.records;

  if (records.length !== count || records.some(record => record.mode !== "kept")) {
    throw new Error("perf fixture: a view of the kept board is not kept");
  }

  return { stage, views, filters, other };
}

/**
 * The board of `keptBoard` whose first view's alpha filter `effects` switches off and on in turn, every frame, as it
 * did for an `Alpha` that crossed 1 in every frame (change 2026-10-18-memory-render, M4): the view is marked through
 * `invalidate` before the switch, then the frame's filter step hands Pixi the view's new list, and the kept cache
 * collects and flushes. The view goes live at its first switch and is not taken again while it switches.
 *
 * @param count - The kept views.
 * @returns One frame of the switch: the mark, the switch, the filter step, the collect and the flush.
 */
export async function alphaSwitchBoard(count: number): Promise<() => void> {
  const { stage, views, filters } = await startKeptBoard(count);
  const { sync, kept, demand } = stage.drawn.mock.modules;
  const view = views[0] ?? 0;
  const filter = filters[0];

  if (filter === undefined) throw new Error("perf fixture: the switch board has no view");

  return () => {
    demand.invalidate(view);
    filter.enabled = !filter.enabled;
    sync.stepFilters();
    kept.collect();
    kept.flush();
  };
}

/**
 * A board whose `count` filtered views the kept cache draws from their pictures (E5), over the real Pixi of the
 * overlay stage, every frame drawn: each view carries one alpha filter the cache may keep, in a frozen list as
 * `effects` hands it over, and stood still long enough to be taken. A frame collects the marks and flushes the cache,
 * as the render phase does: with no mark, a calm frame; with one view elsewhere marked, every record steps.
 *
 * @param count - The kept views.
 * @param marked - True to mark a view that is no kept one's every frame.
 * @returns One frame of the cache: the collect and the flush.
 */
export async function keptBoard(count: number, marked = false): Promise<() => void> {
  const { stage, other } = await startKeptBoard(count);
  const { kept, demand } = stage.drawn.mock.modules;

  return marked
    ? () => {
        demand.mark(other);
        kept.collect();
        kept.flush();
      }
    : () => {
        kept.collect();
        kept.flush();
      };
}
