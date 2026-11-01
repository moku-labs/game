/**
 * @file renderer — the fixtures of the perf files: an agent build whose page clock is a plain function, a steady frame
 * record, and a started renderer with a layer of sprite views. Not a test file. Every fixture is built outside the
 * measured window; what a window calls allocates only what the engine allocates.
 */
import * as pixi from "pixi.js";
import { vi } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import type { FrameMeasure } from "../../../time/types";
import { Layer, Order } from "../../../world/ecs/define";
import { projection } from "../../../world/projection/define";
import type { AnyProjectionSpec } from "../../../world/projection/types";
import type { Entity, SystemTiming } from "../../../world/types";
import {
  HudPart,
  NineSlice,
  type NineSliceValue,
  Parent,
  Shape,
  type ShapeValue,
  Sprite,
  type SpriteValue,
  Transform,
  type TransformValue
} from "../../components";
import { KEY } from "../../kept/geometry";
import { WHY } from "../../kept/types";
import { withDeps } from "../../lifecycle";
import { commitFrame } from "../../monitor/commit";
import { COUNT } from "../../monitor/types";
import type { SyncCtx } from "../../sync/types";
import type { PixiFilter } from "../../types";
import { box, demandAlone } from "../demand-harness";
import { FakeFilter, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";
import { startOverlayStage } from "../overlay-harness";
import { type AgentRenderer, startAgent } from "../perf-harness";
import { shadedSlot } from "../quad-harness";

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

/** A started renderer with slot timers: twelve rings, and the stored `Shape` of the one a frame syncs. */
export type ArcStage = {
  mock: MockRenderer;
  /** The `Shape` the world holds for the synced ring, writable in place. */
  ring: ShapeValue;
};

/**
 * Starts the mock renderer (a release build's pass) with the twelve slot timers of the A26 ward: rings of 28 u, a
 * stroke of 2.2, each over its own share of time left. The pass that builds them has run and every change set is
 * cleared; then one ring's change mark is made once, so every pass after it syncs that ring: compares it and, when a
 * window writes a field in place, builds it again.
 *
 * @returns The stage.
 */
export async function startArcs(): Promise<ArcStage> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  const entities: Entity[] = [];

  for (let index = 0; index < 12; index += 1) {
    entities.push(
      mock.world.ecs.spawn(OWNER, [
        Layer({ name: "items" }),
        Transform({ x: (index % 4) * 40, y: Math.floor(index / 4) * 40 }),
        Shape({
          kind: "arc",
          w: 28,
          h: 28,
          stroke: 0xc8_a1_5a,
          strokeWidth: 2.2,
          sweep: (index + 1) / 12
        })
      ])
    );
  }

  mock.modules.sync.pass();
  mock.world.clearChanges();

  const entity = entities[5] ?? 0;

  mock.world.ecs.set(entity, Shape, { sweep: 0.42 });
  mock.modules.sync.pass();

  const ring = mock.world.ecs.get(entity, Shape);

  if (ring === undefined) throw new Error("perf fixture: the ring has no Shape");

  return { mock, ring: ring as ShapeValue };
}

/** A started renderer with hollow frames: twelve rim-only panels, and the stored `NineSlice` of the one a frame syncs. */
export type HollowStage = {
  mock: MockRenderer;
  /** The `NineSlice` the world holds for the synced panel, writable in place. */
  panel: NineSliceValue;
};

/**
 * Starts the mock renderer (a release build's pass) with twelve hollow frames of a 300 × 300 texture cut 48 across
 * and 40 down, as the glass panels of the memory screen. The pass that builds them has run and every change set is
 * cleared; then one panel's change mark is made once, so every pass after it syncs that panel: compares every field
 * and, when a window writes its size in place, rewrites its vertices.
 *
 * @returns The stage.
 */
export async function startHollows(): Promise<HollowStage> {
  const mock = createMockRenderer();
  const frost = new FakeTexture({
    source: { width: 300, height: 300, destroyed: false },
    defaultBorders: { left: 48, top: 40, right: 48, bottom: 40 }
  });

  await mock.start();
  mock.api.sync.textures.provide(() => frost as never);
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  const entities: Entity[] = [];

  for (let index = 0; index < 12; index += 1) {
    entities.push(
      mock.world.ecs.spawn(OWNER, [
        Layer({ name: "items" }),
        Transform({ x: (index % 3) * 320, y: Math.floor(index / 3) * 420 }),
        NineSlice({ texture: "glass.frost", width: 300, height: 400, hollow: true })
      ])
    );
  }

  mock.modules.sync.pass();
  mock.world.clearChanges();

  const entity = entities[5] ?? 0;

  mock.world.ecs.set(entity, NineSlice, { alpha: 0.9 });
  mock.modules.sync.pass();

  const panel = mock.world.ecs.get(entity, NineSlice);

  if (panel === undefined) throw new Error("perf fixture: the panel has no NineSlice");

  return { mock, panel: panel as NineSliceValue };
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

/**
 * A resting sheet that holds the loops under it (change 2026-10-20-overlay-hold, H2), over the real Pixi of the overlay
 * stage: 20 sharp views of the ward under a landed dim-only overlay with `hold: true`, its range a kept picture that is
 * not blurred. A frame asks for every view what its endless loop asks, and each answer is the owner's hold. The frames
 * that build it and land the sheet have run.
 *
 * @returns One frame: the asks of the loops.
 */
export async function heldRangeBoard(): Promise<() => void> {
  const stage = await startOverlayStage();
  const { sync } = stage.drawn.mock.modules;
  const asked: Entity[] = [];

  for (let index = 0; index < 20; index += 1) {
    asked.push(stage.view({ order: 1, x: (index % 5) * 200, y: Math.floor(index / 5) * 200 }));
  }

  const shop = stage.overlay({ dim: 0.56, hold: true }, { order: 2 });

  stage.level(shop, 1, true);
  stage.frames(2);

  const range = stage.drawn.mock.ctx.state.sync.overlay.active;

  if (range?.kept !== true || range.blurred || asked.some(entity => !sync.loopsHeld(entity))) {
    throw new Error(
      "perf fixture: the sheet with hold does not hold the loops of its kept, sharp range"
    );
  }

  return () => {
    for (const entity of asked) sync.loopsHeld(entity);
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
 * The board of `keptBoard` whose first view fades: its alpha filter takes another alpha every frame, the view marked
 * through `invalidate` first as `effects` does, then the kept cache collects and flushes. A stack of alphas draws its
 * picture direct (F54): the frame writes the quad's alpha and renders nothing.
 *
 * @param count - The kept views.
 * @returns One frame of the fade: the mark, the alpha, the collect and the flush.
 */
export async function keptFadeBoard(count: number): Promise<() => void> {
  const { stage, views, filters } = await startKeptBoard(count);
  const { kept, demand } = stage.drawn.mock.modules;
  const view = views[0] ?? 0;
  const filter = filters[0];

  if (filter === undefined) throw new Error("perf fixture: the fade board has no view");

  let low = false;

  return () => {
    low = !low;
    demand.invalidate(view);
    filter.alpha = low ? 0.4 : 0.6;
    kept.collect();
    kept.flush();
  };
}

/**
 * The board of `keptBoard` whose first view fades through its own alpha (F120), as `applyAlpha` writes it: the view is
 * marked as a move, its top takes another alpha every frame, then the kept cache collects and flushes. Its picture is
 * taken without the top's alpha: the frame writes the quad's alpha and renders nothing.
 *
 * @param count - The kept views.
 * @returns One frame of the fade: the mark, the alpha, the collect and the flush.
 */
export async function keptOwnFadeBoard(count: number): Promise<() => void> {
  const { stage, views } = await startKeptBoard(count);
  const { kept, demand } = stage.drawn.mock.modules;
  const view = views[0] ?? 0;
  const top = stage.drawn.mock.ctx.state.kept.byEntity.get(view)?.top;

  if (top === undefined) throw new Error("perf fixture: the own-fade board has no kept view");

  let low = false;

  return () => {
    low = !low;
    demand.markMoved(view);
    top.alpha = low ? 0.4 : 0.6;
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

/**
 * The board of `keptBoard` after a step of the renderer resolution from 2 to 1 (F126): the pictures keep their textures
 * and owe nothing, and with a view elsewhere marked every record steps through the check of the step. Half of them draw
 * direct, the others keep a filter output through a filter on `"inherit"`.
 *
 * @param count - The kept views.
 * @param resolution - The resolution the step ends on.
 * @returns One frame of the cache: the mark, the collect and the flush.
 */
export async function keptSteppedBoard(count: number, resolution = 1): Promise<() => void> {
  const board = await startInheritBoard(count);
  const { stage, other } = board;
  const { kept, demand } = stage.drawn.mock.modules;
  const { records } = stage.drawn.mock.ctx.state.kept;

  stage.drawn.mock.api.monitor.setResolution(2);
  stage.frames(40);
  stage.drawn.mock.api.monitor.setResolution(resolution);
  stage.frames(2);

  if (records.some(record => record.mode !== "kept" || record.key[KEY.rs] !== 2)) {
    throw new Error("perf fixture: a view of the stepped board is not held through the step");
  }

  return () => {
    demand.mark(other);
    kept.collect();
    kept.flush();
  };
}

/**
 * The board of `keptBoard` settled at a fractional renderer resolution, as on a phone at 2.625: the pictures were taken
 * there, half drawn direct, the others keeping a filter output through a filter on `"inherit"`, and with a view elsewhere
 * marked every record steps.
 *
 * @param count - The kept views.
 * @param resolution - The fractional resolution.
 * @returns One frame of the cache: the mark, the collect and the flush.
 */
export async function keptFractionalBoard(count: number, resolution = 1.5): Promise<() => void> {
  const { stage, other } = await startInheritBoard(count);
  const { kept, demand } = stage.drawn.mock.modules;
  const { records } = stage.drawn.mock.ctx.state.kept;

  stage.drawn.mock.api.monitor.setResolution(resolution);
  stage.frames(40);

  if (records.some(record => record.mode !== "kept" || record.key[KEY.rs] !== resolution)) {
    throw new Error("perf fixture: a view of the fractional board is not kept at its resolution");
  }

  return () => {
    demand.mark(other);
    kept.collect();
    kept.flush();
  };
}

/**
 * The kept board whose filters follow the canvas: every filter on `"inherit"`, every second one with a padding, so it
 * keeps a filter output and the others draw direct.
 *
 * @param count - The kept views.
 * @returns The board, its views taken.
 */
async function startInheritBoard(count: number): Promise<KeptBoard> {
  const board = await startKeptBoard(count);
  const { stage, views, filters } = board;
  const { sync } = stage.drawn.mock.modules;

  for (const [index, view] of views.entries()) {
    const filter = filters[index];

    if (filter === undefined) throw new Error("perf fixture: the stepped board has no filter");

    filter.resolution = "inherit";

    if (index % 2 === 1) filter.padding = 2;

    sync.filters.set(
      view,
      Object.freeze([
        { filter: filter as unknown as PixiFilter, passes: 1, cache: "local" as const }
      ])
    );
  }

  stage.frames(40);

  return board;
}

/**
 * A board of `count` views on their filter's own shader (F126 stage 2), as `rows` of the bench draws them: every view
 * carries one filter with a quad, in a frozen list as `effects` hands it over, and every frame writes every view's number
 * after the mark, then the kept cache collects and flushes. The mesh reads the number itself: the frame renders nothing.
 *
 * @param count - The shaded views.
 * @returns One frame: the marks, the numbers, the collect and the flush.
 */
export async function keptShadedBoard(count: number): Promise<() => void> {
  const stage = await startOverlayStage({ onDemand: false });
  const { sync, kept, demand } = stage.drawn.mock.modules;
  const views: Entity[] = [];
  const numbers: Array<{ amount: number }> = [];

  for (let index = 0; index < count; index += 1) {
    views.push(stage.view({ order: 1, x: (index % 5) * 200, y: Math.floor(index / 5) * 200 }));
  }

  stage.frame();

  for (const view of views) {
    const slot = shadedSlot({ origin: new Float32Array(2) });

    if (slot.quad?.fu !== undefined) numbers.push(slot.quad.fu.uniforms as { amount: number });

    sync.filters.set(view, Object.freeze([slot]));
  }

  stage.frames(12);

  let low = false;
  const frame = (): void => {
    low = !low;

    // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
    for (let index = 0; index < views.length; index += 1) {
      demand.invalidate(views[index] ?? 0);
      // Whole numbers: a new double written to a field is boxed by the write, which the fixture does as `effects` does.
      (numbers[index] ?? { amount: 0 }).amount = low ? 1 : 2;
    }

    kept.collect();
    kept.flush();
  };

  for (let index = 0; index < 4; index += 1) frame();

  const records = stage.drawn.mock.ctx.state.kept.records;

  if (records.length !== count || records.some(record => !record.shaded)) {
    throw new Error("perf fixture: a view of the shaded board is not shaded");
  }

  return frame;
}

/**
 * The board of `keptBoard` with one more filtered view that holds a glow (F68): a panel whose child sprite blends
 * `"add"`, so the cache draws the panel live and remembers why. A view elsewhere is marked every frame, so every record
 * steps, the glowing one included, whose refusal stands without a walk of its subtree.
 *
 * @param count - The kept views.
 * @returns One frame of the cache: the mark, the collect and the flush.
 */
export async function keptBlendBoard(count: number): Promise<() => void> {
  const { stage, other } = await startKeptBoard(count);
  const { sync, kept, demand } = stage.drawn.mock.modules;
  const card = stage.view({ order: 1, x: 900, y: 200 });

  stage.drawn.mock.world.ecs.spawn(OWNER, [
    Parent({ entity: card }),
    Transform({ x: 10, y: 10 }),
    Sprite({ texture: "fx.glow", width: 40, height: 40, blend: "add" })
  ]);
  stage.frame();
  sync.filters.set(
    card,
    Object.freeze([
      {
        filter: new pixi.AlphaFilter() as unknown as PixiFilter,
        passes: 1,
        cache: "local" as const
      }
    ])
  );
  stage.frames(8);

  const record = stage.drawn.mock.ctx.state.kept.byEntity.get(card);

  if (record?.mode !== "live" || !record.blended) {
    throw new Error("perf fixture: the glowing view of the board is not drawn live");
  }

  return () => {
    demand.mark(other);
    kept.collect();
    kept.flush();
  };
}

/**
 * The board of `keptBoard` under a camera zoom (F67): every frame the root above the kept views scales by a step, in
 * turn 1.1 and 1.2, as a glide changes a camera layer's scale, and a view elsewhere is marked. Every record steps and
 * draws its picture scaled; none is retaken.
 *
 * @param count - The kept views.
 * @returns One frame of the zoom: the scale, the mark, the collect and the flush.
 */
export async function keptZoomBoard(count: number): Promise<() => void> {
  const { stage, other } = await startKeptBoard(count);
  const { kept, demand } = stage.drawn.mock.modules;
  const root = stage.drawn.mock.ctx.state.sync.root;

  if (root === undefined) throw new Error("perf fixture: the zoom board has no root");

  let near = false;

  return () => {
    near = !near;
    root.scale.set(near ? 1.2 : 1.1);
    demand.mark(other);
    kept.collect();
    kept.flush();
  };
}

/**
 * The board of `keptBoard` under a translucent root (F113), as a scene fading over the board leaves it in a frame: the
 * root above the kept views at alpha 0.5, a view elsewhere marked every frame, so every record steps and keeps its
 * picture, drawn at the root's alpha by Pixi; none is retaken. The alpha is written once: Pixi's setter stores each new
 * double into `localAlpha` as a heap number (16 B a write that changes it, Pixi's own, like F54's `AlphaFilter.alpha`),
 * which is the fade's write, not the step of the kept cache.
 *
 * @param count - The kept views.
 * @returns One frame under the fade: the mark, the collect and the flush.
 */
export async function keptAncestorFadeBoard(count: number): Promise<() => void> {
  const { stage, other } = await startKeptBoard(count);
  const { kept, demand } = stage.drawn.mock.modules;
  const root = stage.drawn.mock.ctx.state.sync.root;

  if (root === undefined) throw new Error("perf fixture: the fading board has no root");

  root.alpha = 0.5;

  return () => {
    demand.mark(other);
    kept.collect();
    kept.flush();
  };
}

/**
 * `count` live views with a filter whose subtrees change every frame, so none is ever taken (F126): each step of a frame
 * writes why the view is live and how many still frames it lacks, and `collect` notes who marked it.
 *
 * @param count - The views.
 * @returns One frame: the marks, the collect and the flush.
 */
export async function keptWhyBoard(count: number): Promise<() => void> {
  const stage = await startOverlayStage({ onDemand: false });
  const { sync, kept, demand } = stage.drawn.mock.modules;
  const views: Entity[] = [];

  for (let index = 0; index < count; index += 1) {
    views.push(stage.view({ order: 1, x: 50 + index * 100, y: 100 }));
  }

  stage.frame();

  for (const view of views) {
    sync.filters.set(
      view,
      Object.freeze([
        {
          filter: new pixi.ColorMatrixFilter() as unknown as PixiFilter,
          passes: 1,
          cache: "local" as const
        }
      ])
    );
  }

  const step = (): void => {
    for (const view of views) demand.mark(view);

    kept.collect();
    kept.flush();
  };

  for (let frame = 0; frame < 4; frame += 1) step();

  if (stage.drawn.mock.ctx.state.kept.records.some(record => record.why !== WHY.waiting)) {
    throw new Error("perf fixture: a view of the why board is not waiting");
  }

  return step;
}

/**
 * A started renderer of a build, its pass ring holding a pass in an agent build: a begin writes the newest slot.
 *
 * @param agent - True for an agent build.
 * @param clock - `"plain"` for an alloc window, `"real"` for a bench.
 * @returns The renderer.
 */
async function startedRenderer(agent: boolean, clock: "plain" | "real"): Promise<MockRenderer> {
  if (agent) {
    const started = await startPlainAgent(clock);

    started.frame();

    if (started.pc.perf.ring.passes.newest < 0)
      throw new Error("perf fixture: no pass in the ring");

    return started.mock;
  }

  // An agent build started before it left the flag on.
  vi.unstubAllGlobals();

  const started = createMockRenderer();

  await started.start();

  if (started.ctx.state.monitor.perf !== undefined) throw new Error("perf fixture: an agent build");

  return started;
}

/**
 * The listener of the canvas passes the monitor set on the host, inside a frame.
 *
 * @param agent - True for an agent build.
 * @param clock - `"plain"` for an alloc window, `"real"` for a bench.
 * @returns One canvas begin.
 */
export async function canvasBeginStep(
  agent: boolean,
  clock: "plain" | "real" = "plain"
): Promise<() => void> {
  const started = await startedRenderer(agent, clock);
  const { host, monitor } = started.ctx.state;
  const listen = host.onCanvasPass;

  if (listen === undefined) throw new Error("perf fixture: no listener of the canvas passes");

  monitor.sinks.inFrame = true;

  return () => {
    listen(2);
    // A frame's count starts over: a window of calls keeps it a small number.
    monitor.sinks.counts[COUNT.canvas] = 0;
  };
}

/**
 * A live panorama wider than the canvas, with a filter, under a camera zoom (F113): every frame the root scales by a
 * step, in turn 1.01 and 1.02, a view elsewhere is marked, and the panorama stands still under it. Its take would be cut to the canvas, which is
 * never drawn scaled: it is refused once and the record waits for rest, so a frame steps it and tries no take.
 *
 * @returns One frame of the zoom: the scale, the mark, the collect and the flush.
 */
export async function cutZoomBoard(): Promise<() => void> {
  const stage = await startOverlayStage({ onDemand: false });
  const { sync, kept, demand } = stage.drawn.mock.modules;
  const panorama = stage.view({ order: 1, x: -1000, y: 0, w: 3000, h: 400 });
  const other = stage.view({ order: 1, x: 900, y: 1500 });
  const root = stage.drawn.mock.ctx.state.sync.root;

  if (root === undefined) throw new Error("perf fixture: the cut zoom board has no root");

  stage.frame();
  sync.filters.set(
    panorama,
    Object.freeze([
      {
        filter: new pixi.AlphaFilter() as unknown as PixiFilter,
        passes: 1,
        cache: "local" as const
      }
    ])
  );

  let near = false;
  const scale = (): void => {
    near = !near;
    root.scale.set(near ? 1.02 : 1.01);
  };

  // Drawn frames under the zoom: the marks of the build settle, and the panorama is refused once.
  for (let frame = 0; frame < 8; frame += 1) {
    scale();
    stage.frame();
  }

  if (stage.drawn.mock.ctx.state.kept.byEntity.get(panorama)?.mode !== "live") {
    throw new Error("perf fixture: the cut panorama was taken under the zoom");
  }

  return () => {
    scale();
    demand.mark(other);
    kept.collect();
    kept.flush();
  };
}

/**
 * `count` views with an alpha filter off the canvas (F114), a view on it marked every frame: each was tried once in its first
 * eligible frame, rendered nothing and is remembered idle, so a frame steps them and tries no take.
 *
 * @param count - The views off the canvas.
 * @returns One frame: the mark, the collect and the flush.
 */
export async function idleAwayBoard(count: number): Promise<() => void> {
  const stage = await startOverlayStage({ onDemand: false });
  const { sync, kept, demand } = stage.drawn.mock.modules;
  const other = stage.view({ order: 1, x: 900, y: 1500 });
  const views: Entity[] = [];

  for (let index = 0; index < count; index += 1) {
    views.push(stage.view({ order: 1, x: 5000 + index * 100, y: 100 }));
  }

  stage.frame();

  for (const view of views) {
    sync.filters.set(
      view,
      Object.freeze([
        {
          filter: new pixi.AlphaFilter() as unknown as PixiFilter,
          passes: 1,
          cache: "local" as const
        }
      ])
    );
  }

  stage.frames(4);

  const records = stage.drawn.mock.ctx.state.kept.records;

  if (records.length !== count || records.some(record => !record.idle)) {
    throw new Error("perf fixture: a view off the canvas is not idle");
  }

  return () => {
    demand.mark(other);
    kept.collect();
    kept.flush();
  };
}

/**
 * A skipped frame of a dev build with `onDemand` and 300 views over real Pixi render groups, as the case-sheet of
 * A Memory Missing stands idle: after the last drawn frame five views were written without a mark, warned, and stay in
 * Pixi's change lists, because a skipped frame renders nothing. Each call is the after-frame step of one more skipped frame (F69).
 *
 * @param count - How many views the stage holds.
 * @returns One skipped frame's after-frame step.
 */
export function idleMissedMarks(count = 300): () => void {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);

  const alone = demandAlone({ renderGroup: true });
  const objects: pixi.Graphics[] = [];

  for (let entity = 1; entity <= count; entity += 1) {
    const object = box((entity % 20) * 50, Math.floor(entity / 20) * 50, 40);

    objects.push(object);
    alone.view(entity, object);
  }

  alone.demand.settle(alone.demand.decide(false));
  // The drawn frame: Pixi's own transform pass empties the change lists, as a render does.
  pixi.updateRenderGroupTransforms(Reflect.get(alone.stage, "renderGroup"), true);

  for (let at = 0; at < 5; at += 1) {
    const object = objects[at * 60];

    if (object !== undefined) object.x += 1;
  }

  alone.demand.settle(false);

  return () => {
    alone.demand.settle(false);
  };
}

/** A started renderer whose scene build waits for the swap, and the domain context its sync module reads. */
export type WaitingBuild = { mock: MockRenderer; sctx: SyncCtx };

/**
 * A board of 300 sprite views on screen while the next scene is built aside (spec 31): `count` building views made and
 * held, waiting for the commit. The world's clock stands, so the budget of a frame is never spent and one pass does the
 * whole build.
 *
 * @param count - How many building views wait.
 * @returns The started renderer and the sync context.
 */
export async function waitingBuild(count: number): Promise<WaitingBuild> {
  const { mock } = await startSprites(300);

  mock.world.projection.build([], OWNER, [{ name: "items", sort: "none" }], 4);

  for (let index = 0; index < count; index += 1) {
    const entity = mock.world.ecs.spawn(OWNER, [
      Layer({ name: "items" }),
      Transform({ x: index * 10 }),
      Sprite({ texture: "board.cell", width: 64, height: 64 })
    ]);

    mock.world.projection.adopt(entity);
  }

  mock.modules.sync.pass();
  mock.world.clearChanges();

  const { host, viewport, demand, kept } = mock.modules;

  return { mock, sctx: { ctx: withDeps(mock.ctx), deps: { host, viewport, demand, kept } } };
}

/**
 * A warm window on the layer `items`: never shown, its warm item one sheet the size of the screen's middle.
 *
 * @param name - The projection, also the key of its item.
 * @returns The spec.
 */
function warmWindow(name: string): AnyProjectionSpec {
  return projection({
    name,
    layer: "items",
    from: (): Array<{ id: string }> => [],
    key: (item: { id: string }) => item.id,
    view: () => [
      Transform({ x: 180, y: 480 }),
      Sprite({ texture: "board.cell", width: 720, height: 960 })
    ],
    warm: () => ({ id: name })
  }) as unknown as AnyProjectionSpec;
}

/**
 * The root world spawned for a warm window.
 *
 * @param mock - The started renderer.
 * @param name - The window.
 * @returns The entity.
 */
function warmRootOf(mock: MockRenderer, name: string): Entity {
  for (const [entity] of mock.world.ecs.query(Layer)) {
    if (mock.world.projection.keyOf(entity)?.projection === name) return entity;
  }

  throw new Error(`perf fixture: no held view of ${name}`);
}

/**
 * One frame of world and sync: the frame start, world's input step (the reconcile, one warm step), the pass, the
 * change sets closed.
 *
 * @param mock - The started renderer.
 */
function warmFrame(mock: MockRenderer): void {
  mock.world.startFrame();
  mock.world.input();
  mock.modules.sync.pass();
  mock.world.clearChanges();
}

/**
 * A board of 300 sprite views on screen with `windows` warm windows closed (spec 33, slice B+D): the root of each and
 * `elements` sprites under it, marked for it as `ui` marks its elements, built aside, held and ready. World rests:
 * `left()` is `Infinity` and the held tops wait for the open.
 *
 * @param windows - How many windows rest.
 * @param elements - The sprites under each window's root.
 * @returns The started renderer and the sync context.
 */
export async function restingWarm(windows: number, elements: number): Promise<WaitingBuild> {
  const { mock } = await startSprites(300);
  const names = Array.from({ length: windows }, (_, index) => `window.${index}`);

  for (const name of names) mock.world.projection.register(warmWindow(name));
  mock.world.projection.mount(names, OWNER);

  for (const name of names) {
    // The step that spawns the root; its elements, marked while it is in work; the pass that holds the tree.
    mock.world.startFrame();
    mock.world.input();

    const root = warmRootOf(mock, name);

    for (let index = 0; index < elements; index += 1) {
      const element = mock.world.ecs.spawn(OWNER, [
        Transform({ x: (index % 10) * 70, y: Math.floor(index / 10) * 30 }),
        Sprite({ texture: "board.cell", width: 64, height: 24 }),
        Parent({ entity: root })
      ]);

      mock.world.projection.adopt(element);
    }

    mock.modules.sync.pass();
    mock.world.clearChanges();
    // The poll that finds the window ready.
    warmFrame(mock);
  }

  // The step that finds no more work: the world rests.
  warmFrame(mock);

  const held = mock.ctx.state.sync.heldViews.count;

  if (mock.world.projection.left() !== Number.POSITIVE_INFINITY || held !== windows) {
    throw new Error(`perf fixture: ${held} held tops of ${windows} resting windows`);
  }

  const { host, viewport, demand, kept } = mock.modules;

  return { mock, sctx: { ctx: withDeps(mock.ctx), deps: { host, viewport, demand, kept } } };
}

/** A started renderer after a swap, its loader layer above the veil, and one frame's step of it. */
export type FadingLoader = {
  mock: MockRenderer;
  /** One frame: the clock 1 ms on, then the step of the look. */
  step: () => void;
};

/**
 * Starts the mock renderer with the layer `loading` and one sprite of the loader in it, shows a look whose loader is
 * that layer, lifts it above the veil and lands it. `"fade"`: a fade-out of a day, so every window steps it on without
 * reaching its end. `"wait"`: a fade-out of 0 ms, so the layer waits for its view to leave, at alpha 0. The clock moves
 * in whole milliseconds, which a call hands back unboxed.
 *
 * @param phase - `"fade"` or `"wait"`.
 * @returns The renderer and its step.
 */
export async function fadingLoader(phase: "fade" | "wait"): Promise<FadingLoader> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "loading", sort: "none" }]);
  mock.world.ecs.spawn(OWNER, [
    Layer({ name: "loading" }),
    Transform({ x: 540, y: 960 }),
    Sprite({ width: 96, height: 96 })
  ]);
  mock.modules.sync.pass();
  mock.api.sync.leave.show({
    cover: { color: 0, alpha: 0.45, inMs: 0, outMs: phase === "fade" ? 86_400_000 : 0 },
    loader: { afterMs: 0, due: () => "loading" }
  });
  mock.runPhase("render");
  mock.api.sync.leave.land();

  let now = 0;
  const step = (): void => {
    now += 1;
    mock.setNow(now);
    mock.modules.sync.stepLeave();
  };

  if (phase === "wait") {
    // The first step parks the layer; its wait is bounded to a few frames, so a window of many calls keeps it open.
    step();
    const parked = mock.ctx.state.sync.leave.parked;

    if (parked !== undefined) parked.framesLeft = Number.MAX_SAFE_INTEGER;
  }

  return { mock, step };
}

/** A started renderer with a board of A Memory Missing's size under the finger, and the drop target of its lookups. */
export type HoverBoard = {
  mock: MockRenderer;
  /** A slot of the bottom row of the board: the first view a drop lookup at `(drop.x, drop.y)` accepts. */
  target: Entity;
  /** A point over the target, under an item and its shadow. */
  drop: { x: number; y: number };
};

/**
 * Starts the mock renderer with a board of 540 views for the hover hit test (F118): the layer `board` holds 90 slots,
 * each with an item and the item's shadow under it; the layer `items` holds 200 loose pieces in `order`, their order
 * values not in insertion order, and a clipping panel of 60 rows; the layer `hud` holds 10 buttons. The frames that
 * build it have run.
 *
 * @returns The board, its drop target and the point over it.
 */
export async function hoverBoard(): Promise<HoverBoard> {
  const mock = createMockRenderer();
  const { ecs } = mock.world;
  const owner = { kind: "plugin", name: "perf" } as const;
  let target: Entity = 0;

  await mock.start();
  mock.api.sync.textures.provide(() => new FakeTexture({}) as never);
  mock.world.projection.setLayers([
    { name: "board", sort: "none" },
    { name: "items", sort: "order" },
    { name: "hud", sort: "none" }
  ]);

  for (let index = 0; index < 90; index += 1) {
    const at = { x: 60 + (index % 9) * 110, y: 400 + Math.floor(index / 9) * 110 };
    const slot = ecs.spawn(owner, [
      Layer({ name: "board" }),
      Transform(at),
      Sprite({ texture: "slot" })
    ]);
    const item = ecs.spawn(owner, [
      Transform(),
      Sprite({ texture: "item" }),
      Parent({ entity: slot })
    ]);

    ecs.spawn(owner, [
      Transform({ y: 8 }),
      Sprite({ texture: "shadow" }),
      Parent({ entity: item })
    ]);
    if (index === 85) target = slot;
  }

  for (let index = 0; index < 200; index += 1) {
    ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 3000 + index * 10, y: 200 }),
      Sprite({ texture: "piece" }),
      Order({ value: (index * 7) % 13 })
    ]);
  }

  const panel = ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform({ x: 0, y: 1800 }),
    Shape({ w: 1080, h: 200, clip: true }),
    Order({ value: 20 })
  ]);

  for (let index = 0; index < 60; index += 1) {
    ecs.spawn(owner, [
      Transform({ x: 540, y: index * 40 }),
      Sprite({ texture: "row" }),
      Parent({ entity: panel })
    ]);
  }

  for (let index = 0; index < 10; index += 1) {
    ecs.spawn(owner, [
      Layer({ name: "hud" }),
      Transform({ x: 60 + index * 100, y: 60 }),
      Sprite({ texture: "button" })
    ]);
  }

  mock.modules.sync.pass();

  return { mock, target, drop: { x: 60 + 4 * 110, y: 400 + 9 * 110 } };
}

/**
 * A crowd of `count` views with a filter drawn live (F119) under a tinted root, which no picture draws as it is drawn,
 * so none is ever taken; a view elsewhere is marked every frame, so every flush counts the crowd before the step, each
 * walk up its parents to the stage.
 *
 * @param count - The views of the crowd.
 * @returns One frame: the mark, the collect and the flush.
 */
export async function crowdWaitingBoard(count: number): Promise<() => void> {
  const stage = await startOverlayStage({ onDemand: false });
  const { sync, kept, demand } = stage.drawn.mock.modules;
  const other = stage.view({ order: 1, x: 900, y: 1500 });
  const root = stage.drawn.mock.ctx.state.sync.root;
  const views: Entity[] = [];

  if (root === undefined) throw new Error("perf fixture: the crowd board has no root");

  for (let index = 0; index < count; index += 1) {
    views.push(stage.view({ order: 1, x: 50 + index * 100, y: 100 }));
  }

  stage.frame();
  root.tint = 0xff_00_00;

  for (const view of views) {
    sync.filters.set(
      view,
      Object.freeze([
        {
          filter: new pixi.ColorMatrixFilter() as unknown as PixiFilter,
          passes: 1,
          cache: "local" as const
        }
      ])
    );
  }

  stage.frames(4);

  const state = stage.drawn.mock.ctx.state.kept;

  if (state.liveWaiting !== count || state.records.some(record => record.mode !== "live")) {
    throw new Error("perf fixture: the crowd is not drawn live");
  }

  return () => {
    demand.mark(other);
    kept.collect();
    kept.flush();
  };
}
